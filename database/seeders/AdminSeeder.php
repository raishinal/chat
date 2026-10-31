<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use RuntimeException;

class AdminSeeder extends Seeder
{
    public function run(): void
    {
        $email = config('seeding.admin.email');
        $password = config('seeding.admin.password');
        $local = app()->environment('local');
        if ($local && blank($email) && blank($password)) {
            $email = 'admin@example.com';
            $password = 'password';
        }
        if (blank($email) && blank($password)) {
            $this->command?->warn('Admin seed skipped: configure SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.');

            return;
        }

        $attributes = Validator::make([
            'name' => config('seeding.admin.name'),
            'email' => is_string($email) ? strtolower(trim($email)) : $email,
            'password' => $password,
        ], [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:254'],
            'password' => ['required', 'string', Password::min(8)],
        ])->validate();

        $existing = User::where('email', $attributes['email'])->first();
        if ($existing) {
            if ($existing->role !== 'admin') {
                throw new RuntimeException('Admin seed refused: this email belongs to a non-admin account. Use a different email or manage its role through an existing administrator.');
            }
            $this->command?->info('Admin account already exists; no changes made.');

            return;
        }

        $admin = new User($attributes);
        $admin->forceFill([
            'role' => 'admin',
            'status' => 'active',
            'email_verified_at' => now(),
        ])->save();

        $this->command?->info('Admin account created.');
    }
}
