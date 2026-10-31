<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class ConversationReadRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['message_id' => 'required|integer|min:0'];
    }
}
