<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class ProfileUpdateRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['name' => 'required|string|max:100', 'avatar' => 'nullable|file|mimetypes:image/jpeg,image/png,image/webp|max:2048'];
    }
}
