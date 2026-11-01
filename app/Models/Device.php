<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Device extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['push_token' => 'encrypted', 'voip_token' => 'encrypted'];
    }
}
