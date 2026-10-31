<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AttachmentController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CallController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\MessageController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PasswordController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\RealtimeController;
use App\Http\Controllers\InvitationController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.')->group(function () {
    Route::post('tokens', [AuthController::class, 'token'])->middleware('throttle:5,1')->name('tokens.store');
    Route::post('reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:5,1')->name('password.reset');
    Route::post('forgot-password', [AuthController::class, 'reset'])->middleware('throttle:5,1')->name('password.request');
    Route::post('invitations/{invitation}/accept', [InvitationController::class, 'accept'])->middleware('throttle:5,1')->name('invitations.accept');
    Route::middleware(['auth:sanctum', 'active', 'throttle:chat-api'])->group(function () {
        Route::get('me', [AuthController::class, 'me'])->name('me');
        Route::delete('tokens/current', [AuthController::class, 'revoke'])->name('tokens.destroy');
        Route::put('devices', [AuthController::class, 'device'])->name('devices.store');
        Route::post('profile', [ProfileController::class, 'update'])->name('profile.update');
        Route::put('profile/password', [PasswordController::class, 'update'])->middleware('throttle:password-change')->name('profile.password');
        Route::get('users/{user}/avatar', [ProfileController::class, 'avatar'])->name('avatar');
        Route::get('users', [ConversationController::class, 'users'])->name('users');
        Route::get('conversations', [ConversationController::class, 'index'])->name('conversations.index');
        Route::post('conversations', [ConversationController::class, 'store'])->name('conversations.store');
        Route::get('conversations/{conversation}', [ConversationController::class, 'show'])->name('conversations.show');
        Route::get('conversations/{conversation}/messages', [MessageController::class, 'index'])->name('messages.index');
        Route::post('conversations/{conversation}/messages', [MessageController::class, 'store'])->name('messages.store');
        Route::patch('messages/{message}', [MessageController::class, 'update'])->name('messages.update');
        Route::delete('messages/{message}', [MessageController::class, 'destroy'])->name('messages.destroy');
        Route::post('conversations/{conversation}/read', [ConversationController::class, 'read'])->name('conversations.read');
        Route::post('conversations/{conversation}/typing', [ConversationController::class, 'typing'])->middleware('throttle:chat-typing')->name('conversations.typing');
        Route::post('conversations/{conversation}/attachments', [AttachmentController::class, 'store'])->name('attachments.store');
        Route::get('attachments/{attachment}', [AttachmentController::class, 'show'])->name('attachments.show');
        Route::delete('attachments/{attachment}', [AttachmentController::class, 'destroy'])->name('attachments.destroy');
        Route::get('calls', [CallController::class, 'index'])->name('calls.index');
        Route::post('conversations/{conversation}/calls', [CallController::class, 'store'])->name('calls.store');
        Route::patch('calls/{call}', [CallController::class, 'update'])->name('calls.update');
        Route::post('calls/{call}/signal', [CallController::class, 'signal'])->middleware('throttle:180,1')->name('calls.signal');
        Route::get('ice-servers', [CallController::class, 'ice'])->middleware('throttle:turn-credentials')->name('ice');
        Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
        Route::patch('notifications/{notification}/read', [NotificationController::class, 'read'])->name('notifications.read');
        Route::post('broadcasting/auth', [RealtimeController::class, 'auth'])->name('broadcast.auth');
        Route::post('pusher/user-auth', [RealtimeController::class, 'user'])->name('broadcast.user');
        Route::get('admin/users', [AdminController::class, 'index'])->name('admin.index');
        Route::post('admin/users', [AdminController::class, 'store'])->name('admin.store');
        Route::patch('admin/users/{user}', [AdminController::class, 'update'])->name('admin.update');
        Route::delete('admin/users/{user}', [AdminController::class, 'destroy'])->name('admin.destroy');
        Route::post('admin/users/{user}/reset-password', [AdminController::class, 'reset'])->middleware('throttle:5,1')->name('admin.reset');
        Route::get('admin/audit', [AdminController::class, 'auditLog'])->name('admin.audit');
    });
});
