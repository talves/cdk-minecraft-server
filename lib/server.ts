import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as efs from 'aws-cdk-lib/aws-efs'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'

import { CommonRoles } from './commonRoles'
// import { Protocol, UnifiedProtocol } from './util/types'

type TaskDefinitionProps = Pick<ecs.FargateTaskDefinitionProps, 'cpu' | 'memoryLimitMiB'>

interface ImageProps {
  repository: ecr.IRepository | string
  tag?: string
}

interface HealthCheckProps {
  healthCheckPort: number
  protocol: ecs.Protocol
}

interface NetworkProps {
  readonly port: number
  readonly protocol: ecs.Protocol
  readonly healthCheck?: HealthCheckProps
  readonly createLoadBalancer?: boolean
}

export interface ServerProps extends cdk.NestedStackProps {
  readonly vpc: ec2.Vpc
  readonly imageProps: ImageProps
  readonly networkProps: NetworkProps
  readonly taskDefinitionProps?: TaskDefinitionProps
  readonly environmentFile?: string
  readonly containerDefinitionProps?: Omit<ecs.ContainerDefinitionOptions, 'image'>
  readonly fileSystem?: efs.FileSystem
}

export class Server extends cdk.NestedStack {
  readonly serverName: string

  readonly vpc: ec2.Vpc
  readonly subnet: ec2.SubnetSelection
  readonly securityGroup: ec2.SecurityGroup

  readonly logGroup: logs.LogGroup
  readonly taskRole: iam.Role
  readonly taskExecutionRole: iam.Role

  readonly cluster: ecs.Cluster
  readonly service: ecs.FargateService
  readonly container: ecs.ContainerDefinition
  readonly taskDefinition: ecs.FargateTaskDefinition

  readonly targetGroup?: elb.NetworkTargetGroup
  readonly dashboard: cloudwatch.Dashboard

  constructor(scope: Construct, id: string, props: ServerProps) {
    super(scope, id)

    this.serverName = id
    this.vpc = props.vpc

    this.subnet = this.vpc.selectSubnets({
      subnetGroupName: 'GameServers'
    })

    this.securityGroup = this.createSecurityGroup(props)

    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: this.stackName,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    this.taskRole = CommonRoles.taskRole(this, id)
    this.taskExecutionRole = CommonRoles.taskExecutionRole(this, id, {
      logGroup: this.logGroup,
      repository: props.imageProps.repository instanceof ecr.Repository ? props.imageProps.repository : undefined
    })

    this.cluster = this.createCluster(props)

    this.taskDefinition = this.createTaskDefinition(props)
    this.container = this.taskDefinition.addContainer(id, this.containerDefinition(props))
    this.container.addPortMappings({
      containerPort: props.networkProps.port,
      hostPort: props.networkProps.port,
      protocol: props.networkProps.protocol
    })

    if (props.fileSystem) {
      this.addContainerEfsVolume(this.taskDefinition, props.fileSystem)
    }

    if (props.networkProps.healthCheck) {
      this.addHealthCheck(this.container, props.networkProps.healthCheck)
    }

    this.addContainerMountPoints(id, this.container)

    if (this.container.environmentFiles) {
      this.addAccessToEnvironmentFiles(this.container.environmentFiles)
    }

    this.service = this.createService(this.cluster, this.taskDefinition, this.subnet, this.securityGroup)

    if (props.networkProps.createLoadBalancer) {
      this.createLoadBalancer(this.vpc, this.subnet, this.service, props)
    }

    this.dashboard = this.createDashboard(this.serverName)
    this.addMetrics(this.dashboard)
  }

  protected createSecurityGroup(props: ServerProps): ec2.SecurityGroup {
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      securityGroupName: this.serverName,
      description: `${this.serverName} Security Group`,
      allowAllOutbound: false,
      vpc: this.vpc
    })

    securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow outbound HTTPS traffic'
    )

    if (props.networkProps.protocol === ecs.Protocol.TCP) {
      securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(props.networkProps.port),
        `Ingress on port ${props.networkProps.port} for ${this.serverName}`
      )
    } else {
      securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.udp(props.networkProps.port),
        `Ingress on port ${props.networkProps.port} for ${this.serverName}`
      )
    }

    if (props.networkProps.healthCheck) {
      securityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(props.networkProps.healthCheck.healthCheckPort),
        `Ingress on port ${props.networkProps.healthCheck.healthCheckPort} for ${this.serverName} Health Check`
      )
    }

    if (props.fileSystem) {
      securityGroup.connections.allowTo(props.fileSystem, ec2.Port.tcp(2049))
    }

    return securityGroup
  }

  protected createCluster(props: ServerProps): ecs.Cluster {
    return new ecs.Cluster(this, 'Cluster', {
      clusterName: this.serverName,
      vpc: props.vpc
    })
  }

  protected createService(cluster: ecs.Cluster, taskDefinition: ecs.FargateTaskDefinition, subnet: ec2.SubnetSelection, securityGroup: ec2.SecurityGroup): ecs.FargateService {
    return new ecs.FargateService(this, 'FargateService', {
      serviceName: this.serverName,
      cluster: cluster,
      taskDefinition: taskDefinition,
      assignPublicIp: true,
      securityGroups: [securityGroup],
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      vpcSubnets: subnet,

      circuitBreaker: {
        rollback: true
      },

      desiredCount: 1,

      // We do not want autscaling to spin up a second instance! That sounds expensive
      maxHealthyPercent: 100
    })
  }

  protected createTaskDefinition(props: ServerProps): ecs.FargateTaskDefinition {
    return new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: this.serverName,

      executionRole: this.taskExecutionRole,
      taskRole: this.taskRole,

      ...props.taskDefinitionProps
    })
  }

  protected containerDefinition(props: ServerProps): ecs.ContainerDefinitionOptions {
    return {
      containerName: this.serverName,
      image: this.containerImage(props.imageProps),
      essential: true,

      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: this.serverName,
        logGroup: this.logGroup
      }),

      ...props.containerDefinitionProps
    }
  }

  protected containerImage(imageProps: ImageProps): ecs.ContainerImage {
    if (typeof imageProps.repository === 'string') {
      return ecs.ContainerImage.fromRegistry(imageProps.repository)
    }

    return ecs.ContainerImage.fromEcrRepository(imageProps.repository, imageProps.tag)
  }

  protected addContainerEfsVolume(taskDefinition: ecs.FargateTaskDefinition, fileSystem: efs.FileSystem) {
    return taskDefinition.addVolume({
      name: this.serverName,
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId
      }
    })
  }

  /** Health check */
  protected addHealthCheck(container: ecs.ContainerDefinition, props: HealthCheckProps) {
    container.addPortMappings({
      containerPort: props.healthCheckPort,
      hostPort: props.healthCheckPort,
      protocol: props.protocol
    })
  }

  protected addContainerMountPoints(volumeName: string, container: ecs.ContainerDefinition) {
    return container.addMountPoints({
      sourceVolume: volumeName,
      containerPath: `/mnt/${volumeName.toLowerCase()}`,
      readOnly: false
    })
  }

  protected createS3FileAccessPolicy(s3Location: cdk.aws_s3.Location) {
    const getObjectStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:GetObject"],
      resources: [`arn:aws:s3:::${s3Location.bucketName}/${s3Location.objectKey}`]
      
    });
    const getBucketLocationStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:GetBucketLocation"],
      resources: [`arn:aws:s3:::${s3Location.bucketName}`]
    });
    return [getObjectStatement,getBucketLocationStatement]
  }
  
  protected addAccessToEnvironmentFiles(envConfigs: ecs.EnvironmentFileConfig[]) {
    envConfigs.forEach((file: ecs.EnvironmentFileConfig) => {
      this.createS3FileAccessPolicy(file.s3Location).forEach(statement => {
        this.taskExecutionRole.addToPolicy(statement)
      })
    })
  }

  protected createLoadBalancer(
    vpc: ec2.Vpc,
    subnet: ec2.SubnetSelection,
    service: ecs.FargateService,
    props: ServerProps
  ): elb.NetworkLoadBalancer {
    const loadBalancer = new elb.NetworkLoadBalancer(this, 'NLB', {
      loadBalancerName: this.serverName,
      vpc: vpc,
      vpcSubnets: subnet,
      internetFacing: true
    })

    const listener = loadBalancer.addListener('Listener', {
      port: props.networkProps.port,
      protocol: props.networkProps.protocol as elb.Protocol
    })

    listener.addTargets('ECSTarget', {
      targetGroupName: this.serverName,
      port: props.networkProps.port,

      targets: [
        service
      ]
    })

    return loadBalancer
  }

  protected createDashboard(name: string): cloudwatch.Dashboard {
    return new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: name
    })
  }

  protected addMetrics(dashboard: cloudwatch.Dashboard): void {
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'CPU & Memory',

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
        }
      })
    )
  }
}

