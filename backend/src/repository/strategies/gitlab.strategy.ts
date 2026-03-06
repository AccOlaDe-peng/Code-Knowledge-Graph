import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-gitlab2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GitlabStrategy extends PassportStrategy(Strategy, 'gitlab') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get<string>('GITLAB_CLIENT_ID'),
      clientSecret: configService.get<string>('GITLAB_CLIENT_SECRET'),
      callbackURL: configService.get<string>('GITLAB_CALLBACK_URL'),
      scope: ['read_repository'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: any,
  ): Promise<any> {
    const user = {
      provider: 'gitlab',
      providerId: profile.id,
      username: profile.username,
      accessToken,
    };

    done(null, user);
  }
}
