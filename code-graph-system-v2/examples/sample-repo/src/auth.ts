import { User, UserService } from './user';

export class AuthService {
  constructor(private userService: UserService) {}

  async login(email: string, password: string): Promise<User | null> {
    // Simplified login logic
    const users = Array.from(this.userService['users'].values());
    const user = users.find(u => u.email === email);
    return user || null;
  }

  async logout(userId: string): Promise<void> {
    console.log(`User ${userId} logged out`);
  }
}
