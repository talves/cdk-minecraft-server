import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ecr from 'aws-cdk-lib/aws-ecr'

import { Server, ServerProps } from '../server'

type RequiredServerProps = Omit<ServerProps, 'networkProps'>

export interface MincecraftServerProps extends RequiredServerProps {
  environmentFile: string
}

export class MinecraftServer extends Server {
  static readonly healthCheckPort = 8443

  /** The worlds added by both Minecraft and various mods. Used in graphs */
  static readonly worlds = [
    'Overall:',
    'appliedenergistics2:spatial_storage',
    'compactmachines:compact_world',
    'jamd:mining',
    'javd:void',
    'minecraft:overworld',
    'minecraft:the_end',
    'minecraft:the_nether',
    'mythicbotany:alfheim',
    'rats:ratlantis',
    'twilightforest:skylight_forest',
    'twilightforest:twilightforest',
    'undergarden:undergarden',
    'woot:tartarus'
  ]

  constructor(scope: Construct, id: string, props: MincecraftServerProps) {
    super(scope, id, {
      networkProps: {
        port: 25565,
        protocol: ecs.Protocol.TCP,
        healthCheck: {
          healthCheckPort: 8443,
          protocol: ecs.Protocol.TCP
        }
      },

      ...props
    })

    this.taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeNetworkInterfaces',
        'ecs:DescribeTasks',
        'route53:ChangeResourceRecordSets',
        'route53:ListHostedZonesByName'
      ],
      resources: ['*']
    }))
  }

  protected containerDefinition(props: ServerProps): ecs.ContainerDefinitionOptions {
    return {
      image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryName(this, 'repository', 'minecraft')),

      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:${MinecraftServer.healthCheckPort}`],
        startPeriod: cdk.Duration.minutes(5)
      },

      environmentFiles: [
        ecs.EnvironmentFile.fromAsset(props.environmentFile!)
      ],

      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'minecraft',
        logGroup: this.logGroup
      }),

      ...props.containerDefinitionProps
    }
  }

  protected addMetrics(dashboard: cloudwatch.Dashboard): void {
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'CPU & Memory VS Player Count',

        height: 6,
        width: 12,
        period: cdk.Duration.minutes(1),

        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              ServiceName: this.service.serviceName,
              ClusterName: this.cluster.clusterName
            }
          }),

          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            dimensionsMap: {
              ServiceName: this.service.serviceName,
              ClusterName: this.cluster.clusterName
            }
          })
        ],

        leftYAxis: {
          min: 0,
          max: 100,
          showUnits: true
        },

        right: [
          new cloudwatch.Metric({
            namespace: 'GameServers/Minecraft',
            metricName: 'PlayerCount',
            dimensionsMap: {
              ServerName: this.service.serviceName
            }
          })
        ],

        rightYAxis: {
          min: 0,
          showUnits: false
        }
      }),

      new cloudwatch.GraphWidget({
        title: 'CPU & Memory Vs Tick Time',

        height: 6,
        width: 12,
        period: cdk.Duration.minutes(1),

        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              ServiceName: this.service.serviceName,
              ClusterName: this.cluster.clusterName
            }
          }),

          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            dimensionsMap: {
              ServiceName: this.service.serviceName,
              ClusterName: this.cluster.clusterName
            }
          })
        ],

        leftYAxis: {
          min: 0,
          max: 100,
          showUnits: true
        },

        right: [
          new cloudwatch.Metric({
            namespace: 'GameServers/Minecraft',
            metricName: 'Tick Time',
            dimensionsMap: {
              ServerName: this.service.serviceName,
              dimension: 'Overall:'
            }
          })
        ],

        rightYAxis: {
          min: 0,
          showUnits: true
        }
      }),

      new cloudwatch.GraphWidget({
        title: 'TPS by World',
        height: 6,
        width: 12,

        left: MinecraftServer.worlds.map(dimension => {
          return new cloudwatch.Metric({
            namespace: 'GameServers/Minecraft',
            metricName: 'TPS',
            dimensionsMap: {
              ServerName: this.service.serviceName,
              dimension: dimension
            }
          })
        }),

        leftYAxis: {
          min: 0,
          showUnits: false
        }
      }),

      new cloudwatch.GraphWidget({
        title: 'Tick Time by World',
        height: 6,
        width: 12,

        left: MinecraftServer.worlds.map(dimension => {
          return new cloudwatch.Metric({
            namespace: 'GameServers/Minecraft',
            metricName: 'Tick Time',
            dimensionsMap: {
              ServerName: this.service.serviceName,
              dimension: dimension
            }
          })
        }),

        leftYAxis: {
          min: 0,
          showUnits: true
        }
      })
    )
  }
}
