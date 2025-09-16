import { Handler } from 'aws-lambda';
import { DynamoDBClient, ScanCommand, ScanCommandOutput, AttributeValue } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { TodoItem, ExportResult, EnvironmentVariables } from './types';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const snsClient = new SNSClient({});

// Environment variables with defaults
const env: EnvironmentVariables = {
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || 'TodoItems-dev',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME || '',
  SNS_TOPIC_ARN: process.env.SNS_TOPIC_ARN || ''
};

/**
 * Scans DynamoDB table and retrieves all todo items
 */
async function scanTodoItems(): Promise<TodoItem[]> {
  console.log(`Scanning DynamoDB table: ${env.DYNAMODB_TABLE_NAME}`);
  
  const items: TodoItem[] = [];
  let lastEvaluatedKey: Record<string, AttributeValue> | undefined = undefined;
  
  do {
    const command = new ScanCommand({
      TableName: env.DYNAMODB_TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey
    });
    
    const response: ScanCommandOutput = await dynamoClient.send(command);
    
    if (response.Items) {
      const unmarshalled = response.Items.map((item: Record<string, AttributeValue>) => unmarshall(item));
      items.push(...unmarshalled);
    }
    
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  
  console.log(`Retrieved ${items.length} items from DynamoDB`);
  return items;
}

/**
 * Converts array of todo items to CSV format with dynamic headers
 */
function convertToCSV(items: TodoItem[]): string {
  if (items.length === 0) {
    return 'No data available\n';
  }
  
  // Extract all unique attribute names across all items for headers
  const allKeys = new Set<string>();
  items.forEach(item => {
    Object.keys(item).forEach(key => allKeys.add(key));
  });
  
  const headers = Array.from(allKeys).sort();
  console.log(`CSV headers: ${headers.join(', ')}`);
  
  // Create CSV content
  const csvRows: string[] = [];
  
  // Add header row
  csvRows.push(headers.map(header => `"${header}"`).join(','));
  
  // Add data rows
  items.forEach(item => {
    const row = headers.map(header => {
      const value = item[header];
      if (value === null || value === undefined) {
        return '""';
      }
      // Handle different data types and escape quotes
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `"${stringValue.replace(/"/g, '""')}"`;
    });
    csvRows.push(row.join(','));
  });
  
  return csvRows.join('\n') + '\n';
}

/**
 * Uploads CSV content to S3 bucket
 */
async function uploadToS3(csvContent: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `todo-export-${timestamp}.csv`;
  
  console.log(`Uploading CSV to S3: ${env.S3_BUCKET_NAME}/${key}`);
  
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key,
    Body: csvContent,
    ContentType: 'text/csv',
    ContentDisposition: `attachment; filename="${key}"`
  });
  
  await s3Client.send(command);
  
  console.log(`CSV uploaded successfully to S3 key: ${key}`);
  
  return key;
}

/**
 * Generates a pre-signed URL for downloading the S3 object with 5-minute expiration
 */
async function generatePresignedUrl(key: string): Promise<string> {
  console.log(`Generating pre-signed URL for S3 key: ${key}`);
  
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: key
  });
  
  const presignedUrl = await getSignedUrl(s3Client, command, { 
    expiresIn: 300 // 5 minutes = 300 seconds
  });
  
  console.log(`Pre-signed URL generated successfully (expires in 5 minutes)`);
  
  return presignedUrl;
}

/**
 * Sends notification via SNS with pre-signed download link
 */
async function sendNotification(fileName: string, presignedUrl: string): Promise<void> {
  const expirationTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
  
  const message = {
    subject: 'Todo Export Complete',
    message: `Your todo export has been completed successfully.

File: ${fileName}
Download URL: ${presignedUrl}

⚠️  IMPORTANT: This download link expires at ${expirationTime.toISOString()} (5 minutes from generation).
Please download the file promptly.

The export contains all items from your todo list in CSV format.`,
    downloadUrl: presignedUrl,
    fileName,
    expiresAt: expirationTime.toISOString(),
    timestamp: new Date().toISOString()
  };
  
  console.log(`Sending SNS notification to: ${env.SNS_TOPIC_ARN}`);
  
  const command = new PublishCommand({
    TopicArn: env.SNS_TOPIC_ARN,
    Subject: message.subject,
    Message: JSON.stringify(message, null, 2)
  });
  
  await snsClient.send(command);
  console.log('SNS notification sent successfully');
}

/**
 * Main export function that orchestrates the entire process
 */
async function exportTodoItems(): Promise<ExportResult> {
  try {
    // Step 1: Scan DynamoDB table
    const todoItems = await scanTodoItems();
    
    if (todoItems.length === 0) {
      console.log('No todo items found in the table');
      return {
        success: true,
        fileName: 'empty-export.csv',
        error: 'No items found in the table'
      };
    }
    
    // Step 2: Convert to CSV
    const csvContent = convertToCSV(todoItems);
    
    // Step 3: Upload to S3
    const key = await uploadToS3(csvContent);
    
    // Step 4: Generate pre-signed URL
    const presignedUrl = await generatePresignedUrl(key);
    
    // Step 5: Send SNS notification
    await sendNotification(key, presignedUrl);
    
    return {
      success: true,
      fileName: key,
      s3Key: key,
      downloadUrl: presignedUrl
    };
    
  } catch (error) {
    console.error('Error during export process:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Lambda handler function that supports both SQS events and manual invocation
 */
export const handler: Handler = async (event: any) => {
  console.log('Lambda function started');
  console.log('Event received:', JSON.stringify(event, null, 2));
  console.log('Event type:', typeof event);
  console.log('Event keys:', event ? Object.keys(event) : 'event is null/undefined');
  
  // Validate environment variables
  if (!env.S3_BUCKET_NAME) {
    console.error('S3_BUCKET_NAME environment variable is required');
    throw new Error('S3_BUCKET_NAME environment variable is required');
  }
  
  if (!env.SNS_TOPIC_ARN) {
    console.error('SNS_TOPIC_ARN environment variable is required');
    throw new Error('SNS_TOPIC_ARN environment variable is required');
  }
  
  // Check if this is an SQS event or manual invocation
  const isSQSEvent = event && event.Records && Array.isArray(event.Records) && event.Records.length > 0;
  
  if (isSQSEvent) {
    console.log(`Processing ${event.Records.length} SQS messages`);
    
    // Process each SQS message
    for (const record of event.Records) {
      console.log(`Processing message: ${record.messageId}`);
      console.log(`Message body: ${record.body}`);
      
      try {
        const result = await exportTodoItems();
        
        if (result.success) {
          console.log(`Export completed successfully: ${result.fileName}`);
        } else {
          console.error(`Export failed: ${result.error}`);
          // In a production environment, you might want to send the message to a DLQ
          // or implement retry logic here
        }
        
      } catch (error) {
        console.error(`Error processing message ${record.messageId}:`, error);
        // Re-throw to let Lambda handle the error and potentially retry
        throw error;
      }
    }
  } else {
    console.log('Manual invocation detected - running export directly');
    
    try {
      const result = await exportTodoItems();
      
      if (result.success) {
        console.log(`Export completed successfully: ${result.fileName}`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Export completed successfully',
            fileName: result.fileName,
            downloadUrl: result.downloadUrl
          })
        };
      } else {
        console.error(`Export failed: ${result.error}`);
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: 'Export failed',
            error: result.error
          })
        };
      }
      
    } catch (error) {
      console.error('Error during manual export:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'Export failed with exception',
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        })
      };
    }
  }
  
  console.log('Lambda function completed');
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'All SQS messages processed successfully'
    })
  };
};
