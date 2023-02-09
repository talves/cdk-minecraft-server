import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export class Networking extends Construct {
  readonly vpc: ec2.Vpc
  readonly securityGroup: ec2.SecurityGroup

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.vpc = new ec2.Vpc(this, 'VPC', {
      natGateways: 0,
      // cidr: '10.0.1.0/24',
      // ipAddresses: ec2.IpAddresses.cidr("10.0.1.0/24"),
      maxAzs: 1,
      enableDnsHostnames: true,
      enableDnsSupport: true,

      subnetConfiguration: [
        {
          cidrMask: 28,
          name: 'GameServers',
          subnetType: ec2.SubnetType.PUBLIC
        }
      ]
    })

    this.securityGroup = new ec2.SecurityGroup(this, 'ExternalAccess', {
      description: 'Allow inbound traffic on 25565',
      vpc: this.vpc,
      allowAllOutbound: false
    })

    this.securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(25565))

    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow outbound HTTPS traffic'
    )
  }
}
