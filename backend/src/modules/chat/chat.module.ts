import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatChannel } from './entities/chat-channel.entity';
import { ChatChannelMember } from './entities/chat-channel-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { UserPresence } from './entities/user-presence.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatChannel, ChatChannelMember, ChatMessage, UserPresence]),
    JwtModule.register({}),
  ],
  providers: [ChatGateway, ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
