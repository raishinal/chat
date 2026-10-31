<?php

use App\Models\User;
use Database\Seeders\AdminSeeder;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

beforeEach(function () {
    config(['seeding.admin.name' => 'Workspace Owner', 'seeding.admin.email' => 'owner@example.test', 'seeding.admin.password' => 'a-unique-admin-password']);
});

test('database seeding creates an activated admin who can log in', function () {
    $this->seed(DatabaseSeeder::class);
    $admin = User::where('email', 'owner@example.test')->firstOrFail();
    expect($admin->name)->toBe('Workspace Owner');
    expect($admin->role)->toBe('admin');
    expect($admin->status)->toBe('active');
    expect($admin->email_verified_at)->not->toBeNull();
    expect($admin->password)->not->toBe('a-unique-admin-password');
    expect(Hash::check('a-unique-admin-password', $admin->password))->toBeTrue();
    $this->post('/login', ['email' => 'owner@example.test', 'password' => 'a-unique-admin-password'])->assertRedirect('/dashboard');
    $this->assertAuthenticatedAs($admin);
});

test('rerunning the admin seeder never resets credentials or reactivates an account', function () {
    $this->seed(AdminSeeder::class);
    $admin = User::where('email', 'owner@example.test')->firstOrFail();
    $admin->forceFill(['status' => 'suspended', 'name' => 'Existing Name'])->save();
    config(['seeding.admin.password' => 'a-different-new-password']);
    $this->seed(AdminSeeder::class);
    expect(User::count())->toBe(1);
    expect($admin->fresh()->status)->toBe('suspended');
    expect($admin->fresh()->name)->toBe('Existing Name');
    expect(Hash::check('a-unique-admin-password', $admin->fresh()->password))->toBeTrue();
});

test('blank admin credentials skip creation', function () {
    config(['seeding.admin.email' => null, 'seeding.admin.password' => null]);
    $this->seed(AdminSeeder::class);
    $this->assertDatabaseCount('users', 0);
});

test('invalid or incomplete seed credentials do not create an account', function ($email, $password) {
    config(['seeding.admin.email' => $email, 'seeding.admin.password' => $password]);
    expect(fn () => $this->seed(AdminSeeder::class))->toThrow(ValidationException::class);
    $this->assertDatabaseCount('users', 0);
})->with([
    ['owner@example.test', null],
    [null, 'a-unique-admin-password'],
    ['not-an-email', 'a-unique-admin-password'],
    ['owner@example.test', 'short'],
]);

test('admin seeding refuses to promote an existing ordinary user', function () {
    $user = User::factory()->create(['email' => 'owner@example.test']);
    expect(fn () => $this->seed(AdminSeeder::class))->toThrow(RuntimeException::class);
    expect($user->fresh()->role)->toBe('user');
    expect(Hash::check('password', $user->fresh()->password))->toBeTrue();
    $this->assertDatabaseCount('users', 1);
});

test('local seeding supplies the requested test administrator by default', function () {
    $this->app['env'] = 'local';
    config(['seeding.admin.email' => null, 'seeding.admin.password' => null]);
    $this->seed(AdminSeeder::class);
    $admin = User::where('email', 'admin@example.com')->firstOrFail();
    expect($admin->role)->toBe('admin');
    expect($admin->status)->toBe('active');
    $this->app['env'] = 'testing';
    $this->post('/login', ['email' => 'admin@example.com', 'password' => 'password'])->assertRedirect('/dashboard');
    $this->assertAuthenticatedAs($admin);
});

test('production seeding rejects passwords below eight characters', function () {
    $this->app['env'] = 'production';
    config(['seeding.admin.email' => 'admin@example.com', 'seeding.admin.password' => 'short77']);
    expect(fn () => (new AdminSeeder)->run())->toThrow(ValidationException::class);
    $this->assertDatabaseCount('users', 0);
});
