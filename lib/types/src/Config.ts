import {Arguments} from 'yargs';

export type AwsConfig = {
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  assetBucket: string,
};

export type WebpackConfig = {
  mode: string,
  entry: any,
  output: any,
  devtool: string,
  plugins: any,
};

// TODO: GlobalConfig
// This could store the AWS credentials

export type ProjectConfig = {
  aws: AwsConfig,
  webpack: WebpackConfig,
};

export type Argv = Arguments<
  Partial<{
    all: boolean;
  }>
>;