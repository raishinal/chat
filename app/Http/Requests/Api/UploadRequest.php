<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class UploadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('send', $this->route('conversation'));
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['files' => ['required', 'array', 'min:1', 'max:'.config('chat.max_attachments')], 'files.*' => ['required', 'file', 'max:'.config('chat.max_file_kb')]];
    }
}
