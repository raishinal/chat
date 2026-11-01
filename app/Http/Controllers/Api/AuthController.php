<?php

namespace App\Http\Controllers\Api;

use App\Actions\Fortify\ResetUserPassword;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\AuthDeviceRequest;
use App\Http\Requests\Api\AuthResetRequest;
use App\Http\Requests\Api\AuthTokenRequest;
use App\Http\Requests\Api\ResetPasswordRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /** @return array<string, mixed> */
    public function token(AuthTokenRequest $r)
    {
        $v = $r->validated();
        $u = User::where('email', strtolower($v['email']))->first();
        if (! $u || $u->status !== 'active' || ! Hash::check($v['password'], $u->password)) {
            throw ValidationException::withMessages(['email' => 'The credentials are invalid or this account is inactive.']);
        }

        return ['token' => $u->createToken($v['device_name'], ['chat'], now()->addDays(30))->plainTextToken, 'user' => new UserResource($u)];
    }

    /** @return Response */
    public function revoke(Request $r)
    {
        if ($r->bearerToken()) {
            $r->user()->currentAccessToken()->delete();
        }

        return response()->noContent();
    }

    /** @return UserResource */
    public function me(Request $r)
    {
        return new UserResource($r->user());
    }

    /** @return array<string, string> */
    public function reset(AuthResetRequest $r)
    {
        $r->validated();
        $u = User::where('email', $r->email)->where('status', 'active')->first();
        if ($u) {
            Password::sendResetLink(['email' => $u->email]);
        }

        return ['message' => 'If the account is eligible, a reset link has been sent.'];
    }

    /** @return JsonResponse */
    public function device(AuthDeviceRequest $r)
    {
        $v = $r->validated();
        $token = $r->user()->currentAccessToken();
        abort_unless($r->bearerToken() !== null, 422, 'A device requires a mobile login.');
        DB::transaction(function () use ($v, $r, $token) {
            // A physical installation belongs only to its most recent signed-in account.
            DB::table('devices')->where('device_id', $v['device_id'])->where('user_id', '!=', $r->user()->id)->delete();
            $values = ['platform' => $v['platform'], 'personal_access_token_id' => $token->id, 'updated_at' => now()];
            foreach (['push_token', 'voip_token'] as $field) {
                if (array_key_exists($field, $v)) {
                    $values[$field] = $v[$field] ? Crypt::encryptString($v[$field]) : null;
                }
            }
            DB::table('devices')->updateOrInsert(['user_id' => $r->user()->id, 'device_id' => $v['device_id']], $values + ['created_at' => now()]);
        });

        return response()->json(['push_delivery_enabled' => (bool) config('push.firebase_credentials'), 'voip_delivery_enabled' => (bool) config('push.apns_key_path')], 201);
    }

    /** @return array<string, string> */
    public function resetPassword(ResetPasswordRequest $r)
    {
        $credentials = $r->validated();
        $user = User::where('email', $credentials['email'])->where('status', 'active')->first();
        if (! $user) {
            throw ValidationException::withMessages(['email' => 'This reset link is invalid or the account is inactive.']);
        }
        $status = Password::reset($credentials, function (User $user, string $password) {
            app(ResetUserPassword::class)->reset($user, ['password' => $password, 'password_confirmation' => $password]);
            $user->forceFill(['remember_token' => Str::random(60)])->save();
            $user->tokens()->delete();
            DB::table('sessions')->where('user_id', $user->id)->delete();
        });
        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['email' => __($status)]);
        }

        return ['message' => 'Password reset. Sign in again on your devices.'];
    }
}
