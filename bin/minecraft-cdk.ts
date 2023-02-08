#!/usr/bin/env node

import 'source-map-support/register'

import * as cdk from 'aws-cdk-lib'

import { GameServersBaseStack } from '../lib/gameServersBaseStack'
import { MinecraftServer } from '../lib/servers/minecraft'

const app = new cdk.App()
const baseStack = new GameServersBaseStack(app, 'GameServersBaseStack')


new MinecraftServer(app, 'Minecraft', {
  vpc: baseStack.vpc,
  fileSystem: baseStack.fileSystem,
  environmentFile: 'etc/minecraft.env',
  imageProps: {
    repository: baseStack.repository
  },

  taskDefinitionProps: {
    cpu: 4096,
    memoryLimitMiB: 10240
  },

  tags: {
    Name: 'Minecraft'
  }
})
