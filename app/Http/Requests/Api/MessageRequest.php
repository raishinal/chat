<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class MessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('send', $this->route('conversation'));
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['client_id' => ['required', 'uuid'], 'body' => ['nullable', 'string', 'max:4000', 'required_without:attachment_ids'], 'attachment_ids' => ['nullable', 'array', 'max:'.config('chat.max_attachments'), 'required_without:body'], 'attachment_ids.*' => ['integer', 'distinct']];
    }
}
