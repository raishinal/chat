<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\ChangePasswordRequest;
use App\Jobs\TerminateConnections;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class PasswordController extends Controller
{
    public function update(ChangePasswordRequest $request): JsonResponse
    {
        $values = $request->validated();
        DB::transaction(function () use ($request, $values): void {
            $user = User::lockForUpdate()->findOrFail($request->user()->id);
            if (! Hash::check($values['current_password'], $user->password)) {
                throw ValidationException::withMessages(['current_password' => 'The current password is incorrect.']);
            }
            $user->forceFill(['password' => $values['password'], 'remember_token' => Str::random(60)])->save();
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();
            $token = $request->user()->currentAccessToken();
            $tokens = $user->tokens();
            if ($token instanceof PersonalAccessToken) {
                $tokens->where('id', '!=', $token->getKey());
            }
            $tokens->delete();
            $sessions = DB::table('sessions')->where('user_id', $user->id);
            if ($request->hasSession() && ! $request->bearerToken()) {
                $sessions->where('id', '!=', $request->session()->getId());
            }
            $sessions->delete();
            if (config('broadcasting.default') === 'pusher') {
                TerminateConnections::dispatch($user->id)->afterCommit();
            }
        });
        // Sanctum stores the guard user's password hash after this response.
        $request->user()->refresh();

        return response()->json(['message' => 'Password changed. Other devices have been signed out.']);
    }
}
