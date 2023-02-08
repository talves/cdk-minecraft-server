import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as efs from 'aws-cdk-lib/aws-efs'

import { Networking } from './networking'

export class GameServersBaseStack extends cdk.Stack {
  readonly repository: ecr.Repository
  readonly vpc: ec2.Vpc
  readonly securityGroup: ec2.SecurityGroup
  readonly fileSystem: efs.FileSystem

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const repository = new ecr.Repository(this, 'MinecraftRepository', {
      repositoryName: 'minecraft',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    const network = new Networking(this, 'MinecraftNetwork')
    this.vpc = network.vpc
    this.securityGroup = network.securityGroup

    this.fileSystem = this.createEfsVolume('Minecraft')

    new cdk.CfnOutput(this, 'RepositoryUri', {
      description: 'ECR repository URI',
      value: repository.repositoryUri
    })
  }

  createEfsVolume(name: string): efs.FileSystem {
    const securityGroup = new ec2.SecurityGroup(this, `${name}EfsSecurityGroup`, {
      securityGroupName: `${name} EFS`,
      description: `Allow access to the ${name} EFS volume`,
      allowAllOutbound: false,
      vpc: this.vpc
    })

    const filesystem = new efs.FileSystem(this, name, {
      fileSystemName: name,
      vpc: this.vpc,
      securityGroup: securityGroup,

      encrypted: true,
      enableAutomaticBackups: true,

      // https://aws.amazon.com/efs/features/infrequent-access/?&trk=el_a131L0000057zi2QAA&trkCampaign=CSI_Q2_2019_Storage_BizApps_EFS-IA_LP&sc_channel=el&sc_campaign=CSI_08_2019_Storage_EFS_Console&sc_outcome=CSI_Digital_Marketing
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT
    })

    filesystem.addAccessPoint(`${name}AccessPoint`)

    return filesystem
  }
}
