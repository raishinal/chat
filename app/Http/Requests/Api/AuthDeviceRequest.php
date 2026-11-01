<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class AuthDeviceRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['device_id' => 'required|uuid', 'platform' => 'required|in:ios,android,web', 'push_token' => 'nullable|string|max:4096', 'voip_token' => 'nullable|string|max:4096'];
    }
}
