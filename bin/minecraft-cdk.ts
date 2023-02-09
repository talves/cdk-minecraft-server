#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import { GameServersBaseStack } from "../lib/gameServersBaseStack";
import { MinecraftServer } from "../lib/servers/minecraft";

/* Change the next line for the Region you want to deploy the stack to. 
  You can use the default region if you would like also. */
const env = {
  // account: process.env.CDK_DEFAULT_ACCOUNT,
  // region: process.env.CDK_DEFAULT_REGION,
  region: "us-west-2",
};

class ParentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const baseStack = new GameServersBaseStack(this, "GameServersBaseStack");
    const mcStack = new MinecraftServer(this, "Minecraft", {
      // env,
      vpc: baseStack.vpc,
      fileSystem: baseStack.fileSystem,
      environmentFile: "etc/minecraft.env",
      imageProps: {
        repository: baseStack.repository,
      },

      taskDefinitionProps: {
        cpu: 4096,
        memoryLimitMiB: 10240,
      },
    });
    mcStack.addDependency(baseStack);
  }
}

const parentStack = new ParentStack(new cdk.App(), "GameServers", { env });
