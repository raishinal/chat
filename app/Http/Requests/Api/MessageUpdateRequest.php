<?php

namespace App\Http\Requests\Api;

use App\Models\Message;
use Illuminate\Foundation\Http\FormRequest;

class MessageUpdateRequest extends FormRequest
{
    public function authorize(): bool
    {
        $message = $this->route('message');

        return $message instanceof Message && $this->user()->id === $message->sender_id && $this->user()->can('view', $message->conversation);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['body' => ['present', 'nullable', 'string', 'max:4000']];
    }
}
