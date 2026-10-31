<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class ResetPasswordRequest extends FormRequest
{
    /** @return array<string,mixed> */
    public function rules(): array
    {
        return ['email' => ['required', 'email'], 'token' => ['required', 'string'], 'password' => ['required', 'confirmed', Password::min(8)]];
    }
}
