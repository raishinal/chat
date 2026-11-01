<?php

use App\Events\ChatEvent;
use Illuminate\Broadcasting\BroadcastEvent;
use Illuminate\Broadcasting\BroadcastManager;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Queue;

test('call transitions bypass the background queue', function () {
    Bus::fake([BroadcastEvent::class]);
    Queue::fake();

    app(BroadcastManager::class)->queue(new ChatEvent('v1.users.1', 'v1.call.updated', ['id' => 1, 'status' => 'accepted']));

    Bus::assertDispatched(BroadcastEvent::class, fn ($job) => $job->event->name === 'v1.call.updated');
    Queue::assertNothingPushed();
});

test('message broadcasts retain background queue delivery', function () {
    Bus::fake([BroadcastEvent::class]);
    Queue::fake();

    app(BroadcastManager::class)->queue(new ChatEvent('v1.conversations.1', 'v1.message.created', ['id' => 1]));

    Queue::assertPushed(BroadcastEvent::class);
    Bus::assertNothingDispatched();
});
