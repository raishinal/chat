<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class CallSignalRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['type' => 'required|in:offer,answer,ice', 'payload' => 'required|array:sdp,type,candidate,sdpMid,sdpMLineIndex,usernameFragment', 'payload.sdp' => 'required_if:type,offer,answer|nullable|string|max:24000', 'payload.type' => 'nullable|in:offer,answer', 'payload.candidate' => 'required_if:type,ice|nullable|string|max:4000', 'payload.sdpMid' => 'nullable|string|max:100', 'payload.sdpMLineIndex' => 'nullable|integer|min:0', 'payload.usernameFragment' => 'nullable|string|max:256'];
    }
}
