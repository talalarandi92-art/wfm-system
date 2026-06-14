import { Module } from '@nestjs/common';
import { OutagesController } from './outages.controller';
import { MailerService } from '@common/mailer/mailer.service';

@Module({ controllers: [OutagesController], providers: [MailerService] })
export class OutagesMgmtModule {}
