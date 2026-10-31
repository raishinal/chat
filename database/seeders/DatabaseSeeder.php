<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(AdminSeeder::class);

        if (! app()->environment('local')) {
            $this->command?->warn('Demo seed is restricted to APP_ENV=local.');

            return;
        }
        foreach (['Maya Chen', 'Alex Morgan', 'Sam Rivera', 'Jordan Lee'] as $name) {
            $email = Str::slug($name).'@example.test';
            if (User::where('email', $email)->exists()) {
                continue;
            }
            $password = Str::random(24);
            User::factory()->create(compact('name', 'email', 'password'));
            $this->command?->line($email.' / '.$password);
        }
        $this->command?->warn('Random development credentials were printed once. Do not use demo accounts in production. Configure the admin seeder or use chat:admin to create an admin.');
    }
}
