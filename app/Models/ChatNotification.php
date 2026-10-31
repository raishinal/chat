<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ChatNotification extends Model
{
    protected $guarded = ['id'];

    protected $attributes = ['read_at' => null];

    protected function casts(): array
    {
        return ['data' => 'array', 'read_at' => 'datetime'];
    }
}
