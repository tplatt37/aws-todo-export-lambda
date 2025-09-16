export interface TodoItem {
  [key: string]: string | number | boolean | null | undefined | object;
}

export interface ExportResult {
  success: boolean;
  fileName?: string;
  s3Key?: string;
  downloadUrl?: string;
  error?: string;
}

export interface EnvironmentVariables {
  DYNAMODB_TABLE_NAME: string;
  S3_BUCKET_NAME: string;
  SNS_TOPIC_ARN: string;
}
