<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

class CreateAdmin extends Command
{
    protected $signature = 'chat:admin {email?} {--name=}';

    protected $description = 'Securely create an activated administrator using a hidden password prompt';

    public function handle(): int
    {
        $email = strtolower($this->argument('email') ?: $this->ask('Email'));
        $name = $this->option('name') ?: $this->ask('Name');
        $password = $this->secret('Password (at least 8 characters)');
        $v = Validator::make(compact('email', 'name', 'password'), ['email' => 'required|email|unique:users', 'name' => 'required|string|max:100', 'password' => ['required', Password::min(8)]]);
        if ($v->fails()) {
            $this->error($v->errors()->first());

            return self::FAILURE;
        } if ($password !== $this->secret('Confirm password')) {
            $this->error('Passwords do not match.');

            return self::FAILURE;
        } $u = new User(compact('email', 'name', 'password'));
        $u->forceFill(['role' => 'admin', 'status' => 'active', 'email_verified_at' => now()])->save();
        $this->info('Administrator created.');

        return self::SUCCESS;
    }
}
