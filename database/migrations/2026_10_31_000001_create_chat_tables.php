<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $t) {
            $t->string('role')->default('user')->index();
            $t->string('status')->default('active')->index();
            $t->timestamp('last_seen_at')->nullable();
            $t->string('avatar_path')->nullable();
        });
        Schema::create('personal_access_tokens', function (Blueprint $t) {
            $t->id();
            $t->morphs('tokenable');
            $t->text('name');
            $t->string('token', 64)->unique();
            $t->text('abilities')->nullable();
            $t->timestamp('last_used_at')->nullable();
            $t->timestamp('expires_at')->nullable()->index();
            $t->timestamps();
        });
        Schema::create('invitations', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $t->string('token_hash', 64);
            $t->timestamp('expires_at');
            $t->timestamp('used_at')->nullable();
            $t->timestamps();
        });
        Schema::create('conversations', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_one_id')->constrained('users')->restrictOnDelete();
            $t->foreignId('user_two_id')->constrained('users')->restrictOnDelete();
            $t->unsignedBigInteger('one_read_id')->default(0);
            $t->unsignedBigInteger('two_read_id')->default(0);
            $t->timestamps();
            $t->unique(['user_one_id', 'user_two_id']);
        });
        Schema::create('messages', function (Blueprint $t) {
            $t->id();
            $t->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $t->foreignId('sender_id')->constrained('users')->restrictOnDelete();
            $t->uuid('client_id');
            $t->text('body')->nullable();
            $t->timestamps();
            $t->unique(['sender_id', 'client_id']);
            $t->index(['conversation_id', 'id']);
        });
        Schema::create('attachments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->restrictOnDelete();
            $t->foreignId('message_id')->nullable()->constrained()->nullOnDelete();
            $t->string('disk');
            $t->string('path')->unique();
            $t->string('thumbnail_path')->nullable();
            $t->string('name');
            $t->string('mime');
            $t->unsignedBigInteger('size');
            $t->timestamps();
        });
        Schema::create('calls', function (Blueprint $t) {
            $t->id();
            $t->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $t->foreignId('caller_id')->constrained('users')->restrictOnDelete();
            $t->foreignId('callee_id')->constrained('users')->restrictOnDelete();
            $t->string('kind');
            $t->string('status')->index();
            $t->timestamp('connected_at')->nullable();
            $t->timestamp('ended_at')->nullable();
            $t->timestamp('expires_at')->index();
            $t->timestamps();
        });
        Schema::create('active_calls', function (Blueprint $t) {
            $t->foreignId('user_id')->primary()->constrained()->cascadeOnDelete();
            $t->foreignId('call_id')->constrained()->cascadeOnDelete();
        });
        Schema::create('chat_notifications', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('kind');
            $t->json('data');
            $t->timestamp('read_at')->nullable();
            $t->timestamps();
            $t->index(['user_id', 'id']);
        });
        Schema::create('devices', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->uuid('device_id');
            $t->string('platform');
            $t->text('push_token')->nullable();
            $t->timestamps();
            $t->unique(['user_id', 'device_id']);
        });
        Schema::create('audit_logs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('subject_id')->nullable()->constrained('users')->nullOnDelete();
            $t->string('action');
            $t->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['audit_logs', 'devices', 'chat_notifications', 'active_calls', 'calls', 'attachments', 'messages', 'conversations', 'invitations', 'personal_access_tokens'] as $table) {
            Schema::dropIfExists($table);
        } Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['role', 'status', 'last_seen_at', 'avatar_path']));
    }
};
