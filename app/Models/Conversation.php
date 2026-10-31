<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Conversation extends Model
{
    protected $guarded = ['id'];

    protected $attributes = ['one_read_id' => 0, 'two_read_id' => 0];

    /** @return BelongsTo<User, $this> */
    public function one(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_one_id');
    }

    /** @return BelongsTo<User, $this> */
    public function two(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_two_id');
    }

    /** @return HasMany<Message, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    /** @return HasMany<Attachment, $this> */
    public function attachments(): HasMany
    {
        return $this->hasMany(Attachment::class);
    }

    public function other(int $id): User
    {
        return $id === $this->user_one_id ? $this->two : $this->one;
    }

    public function readId(int $id): int
    {
        return $id === $this->user_one_id ? $this->one_read_id : $this->two_read_id;
    }
}
