<?php

use App\Http\Controllers\InvitationController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', fn () => auth()->check() ? to_route('dashboard') : Inertia::render('auth/login', ['canResetPassword' => true]))->name('home');
Route::get('invitations/{invitation}', [InvitationController::class, 'show'])->middleware('throttle:20,1')->name('invitation.show');
Route::post('invitations/{invitation}', [InvitationController::class, 'accept'])->middleware('throttle:5,1')->name('invitation.accept');
Route::middleware(['auth', 'active', 'verified'])->group(function () {
    Route::inertia('dashboard', 'messenger')->name('dashboard');
});
require __DIR__.'/settings.php';
