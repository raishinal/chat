<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class RealtimeUserRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['socket_id' => ['required', 'regex:/^\d+\.\d+$/']];
    }
}
