<?php

namespace App\Http\Requests\Api;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AdminUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->role === 'admin';
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['name' => ['required', 'string', 'max:100'], 'email' => ['required', 'email', 'max:254', Rule::unique('users')->ignore($this->route('user') instanceof User ? $this->route('user')->id : null)], 'role' => ['required', Rule::in(['admin', 'user'])], 'status' => ['sometimes', Rule::in(['active', 'suspended'])]];
    }
}
