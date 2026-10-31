<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CallRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['kind' => ['required', Rule::in(['audio', 'video'])]];
    }
}
