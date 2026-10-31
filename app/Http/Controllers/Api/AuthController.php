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
        DB::table('devices')->updateOrInsert(['user_id' => $r->user()->id, 'device_id' => $v['device_id']], ['platform' => $v['platform'], 'push_token' => isset($v['push_token']) ? encrypt($v['push_token']) : null, 'updated_at' => now(), 'created_at' => now()]);

        return response()->json(['push_delivery_enabled' => false], 201);
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
