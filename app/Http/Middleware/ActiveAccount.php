<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ActiveAccount
{
    /** @return Response */
    public function handle(Request $request, Closure $next)
    {
        if ($request->user() && $request->user()->status !== 'active') {
            $request->user()->tokens()->delete();
            if ($request->hasSession()) {
                auth('web')->logout();
                $request->session()->invalidate();
            }
            abort(403, 'This account is not active. Contact your administrator.');
        }
        if ($request->user() && (! $request->user()->last_seen_at || $request->user()->last_seen_at->lt(now()->subMinute()))) {
            $request->user()->forceFill(['last_seen_at' => now()])->save();
        }

        return $next($request);
    }
}
