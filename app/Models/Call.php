<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property CarbonInterface $expires_at
 * @property CarbonInterface|null $connected_at
 * @property CarbonInterface|null $ended_at
 * @property CarbonInterface|null $caller_seen_at
 * @property CarbonInterface|null $callee_seen_at
 */
class Call extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'connected_at' => 'datetime', 'caller_seen_at' => 'datetime', 'callee_seen_at' => 'datetime', 'ended_at' => 'datetime'];
    }

    /** @return BelongsTo<Conversation, $this> */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }
}
