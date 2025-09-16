# AWS Todo Export Lambda

A TypeScript-based AWS Lambda function that exports DynamoDB todo items to CSV format when triggered by SQS messages. The function scans a DynamoDB table, converts all items to CSV with dynamic headers, uploads the file to S3, and sends a notification via SNS.

Generated with Cline and Anthropic Claude Sonnet 4.1

## Architecture

- **Trigger**: SQS Queue message
- **Data Source**: DynamoDB table (configurable)
- **Storage**: S3 bucket for CSV exports
- **Notification**: SNS topic for completion alerts
- **Runtime**: Node.js 18.x with TypeScript

## Features

- ✅ Dynamic CSV generation (no hardcoded column names)
- ✅ Handles large datasets with DynamoDB pagination
- ✅ Comprehensive error handling and logging
- ✅ Async/await for all AWS operations
- ✅ Custom IAM policy with least-privilege permissions
- ✅ Configurable via environment variables
- ✅ TypeScript for type safety

## Prerequisites

- AWS CLI configured
- AWS SAM CLI installed
- Node.js 18.x or later
- Existing SQS queue, S3 bucket, and SNS topic

## Project Structure

```
├── src/
│   ├── handler.ts          # Main Lambda function
│   └── types.ts           # TypeScript interfaces
├── template.yaml          # SAM template
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

## Deployment

### Using SAM CLI

1. Build the application:
```bash
sam build
```

2. Deploy with guided deployment (first time):
```bash
sam deploy --guided
```

You'll be prompted for the following parameters:
- **SQSQueueArn**: ARN of your existing SQS queue
- **S3BucketName**: Name of your existing S3 bucket
- **SNSTopicArn**: ARN of your existing SNS topic
- **DynamoDBTableName**: Name of your DynamoDB table (default: TodoItems-dev)

3. For subsequent deployments:
```bash
sam deploy
```

### Manual Parameter Example

```bash
sam deploy \
  --parameter-overrides \
    SQSQueueArn=arn:aws:sqs:us-east-1:123456789012:todo-export-queue \
    S3BucketName=my-todo-exports-bucket \
    SNSTopicArn=arn:aws:sns:us-east-1:123456789012:todo-export-notifications \
    DynamoDBTableName=TodoItems-dev
```

## Configuration

### Environment Variables

The Lambda function uses the following environment variables (automatically set by SAM):

- `DYNAMODB_TABLE_NAME`: DynamoDB table to scan for todo items
- `S3_BUCKET_NAME`: S3 bucket for storing CSV exports
- `SNS_TOPIC_ARN`: SNS topic for sending notifications

### IAM Permissions

The function includes a custom IAM policy with the following permissions:

- **SQS**: ReceiveMessage, DeleteMessage, GetQueueAttributes
- **DynamoDB**: Scan on the specified table
- **S3**: PutObject, PutObjectAcl on the specified bucket
- **SNS**: Publish to the specified topic

## Usage

### Triggering an Export

Send a message to your configured SQS queue. The message content can be anything - the Lambda function will process any message as a trigger to start the export process.

Example using AWS CLI:
```bash
aws sqs send-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/todo-export-queue \
  --message-body "Start todo export"
```

### Export Process

1. **SQS Trigger**: Lambda function receives SQS message
2. **DynamoDB Scan**: Scans the entire todo table with pagination
3. **CSV Generation**: Creates CSV with dynamic headers based on all item attributes
4. **S3 Upload**: Uploads CSV file with timestamp-based naming
5. **SNS Notification**: Sends notification with download URL

### Output

- **CSV File**: Stored in S3 with naming pattern: `todo-export-YYYY-MM-DDTHH-mm-ss-sssZ.csv`
- **Download URL**: Public URL format: `https://your-bucket.s3.amazonaws.com/todo-export-timestamp.csv`
- **SNS Message**: JSON formatted notification with file details

## CSV Format

The CSV export includes:
- **Header Row**: All unique attribute names from DynamoDB items (sorted alphabetically)
- **Data Rows**: All items with proper escaping for special characters
- **Empty Values**: Represented as empty quoted strings `""`
- **Complex Types**: Objects/arrays are JSON stringified

Example CSV output:
```csv
"createdAt","description","id","priority","status"
"2023-09-16T10:30:00Z","Buy groceries","todo-1","high","pending"
"2023-09-16T11:00:00Z","Walk the dog","todo-2","medium","completed"
```

## Development

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Build TypeScript:
```bash
npm run build
```

3. Run tests (when implemented):
```bash
npm test
```

### Code Structure

- **handler.ts**: Main Lambda function with SQS event handling
- **types.ts**: TypeScript interfaces for type safety
- **template.yaml**: SAM template with IAM policies and configuration

## Monitoring

The function logs extensively to CloudWatch Logs:
- Message processing details
- DynamoDB scan progress
- S3 upload confirmation
- SNS notification status
- Error details with stack traces

## Error Handling

- **Validation**: Checks for required environment variables
- **DynamoDB**: Handles pagination and empty results
- **S3**: Proper error handling for upload failures
- **SNS**: Notification failure handling
- **SQS**: Message processing errors are re-thrown for Lambda retry logic

## Troubleshooting

### Common Issues

1. **Permission Denied**: Verify IAM policies match your resource ARNs
2. **Table Not Found**: Check DynamoDB table name and region
3. **S3 Upload Failed**: Verify bucket exists and permissions are correct
4. **SNS Publish Failed**: Check topic ARN and permissions

### Logs

Check CloudWatch Logs for the Lambda function:
```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/your-function-name
```

## License

MIT License - see LICENSE file for details.
