import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as ecr from 'aws-cdk-lib/aws-ecr'

interface CommonRoleProps {
  logGroup: logs.ILogGroup
  repository?: ecr.IRepository
}

export class CommonRoles {
  static taskRole(scope: Construct, id: string): iam.Role {
    const role = new iam.Role(scope, 'TaskRole', {
      roleName: `${id}TaskRole`,
      description: 'Write CloudWatch metrics',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    })

    // Write to CloudWatch metrics
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudwatch:PutMetricData'
      ],
      resources: [
        '*'
      ],
      effect: iam.Effect.ALLOW
    }))

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'secretsmanager:GetSecretValue',
        'ssm:GetParameters'
      ],
      resources: ['*']
    }))

    return role
  }

  static taskExecutionRole(scope: Construct, id: string, props: CommonRoleProps): iam.Role {
    const role = new iam.Role(scope, 'TaskExecutionRole', {
      roleName: `${id}TaskExecutionRole`,
      description: 'Read from ECR and write to CloudWatch logs',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    })

    // Write to CloudWatch logs
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: [
        props.logGroup.logGroupArn
      ]
    }))

    // Read from local ECR repository
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage'
      ],
      resources: [
        props.repository ? props.repository.repositoryArn : '*'
      ],
      effect: iam.Effect.ALLOW
    }))

    // log into any ECR registry
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:GetAuthorizationToken'
      ],
      resources: [
        '*'
      ],
      effect: iam.Effect.ALLOW
    }))

    return role
  }
}
