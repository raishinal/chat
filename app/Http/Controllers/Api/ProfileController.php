<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\ProfileUpdateRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class ProfileController extends Controller
{
    /** @return UserResource */
    public function update(ProfileUpdateRequest $r)
    {
        $v = $r->validated();
        $u = $r->user();
        $u->name = $v['name'];
        if ($r->hasFile('avatar')) {
            $old = $u->avatar_path;
            $u->avatar_path = $r->file('avatar')->store('avatars', 'local');
            if ($old) {
                Storage::disk('local')->delete($old);
            }
        } $u->save();

        return new UserResource($u);
    }

    /** @return Response */
    public function avatar(Request $r, User $user)
    {
        abort_unless($user->status === 'active' && $user->avatar_path, 404);

        return app(AttachmentController::class)->stream($r, 'local', $user->avatar_path, 'avatar', Storage::disk('local')->mimeType($user->avatar_path) ?: 'application/octet-stream', true);
    }
}
