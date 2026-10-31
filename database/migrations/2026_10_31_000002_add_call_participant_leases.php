<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calls', function (Blueprint $t) {
            $t->timestamp('caller_seen_at')->nullable();
            $t->timestamp('callee_seen_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('calls', fn (Blueprint $t) => $t->dropColumn(['caller_seen_at', 'callee_seen_at']));
    }
};
