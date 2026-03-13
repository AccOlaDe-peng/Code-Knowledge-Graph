import { UserService } from './user';
import { AuthService } from './auth';

const userService = new UserService();
const authService = new AuthService(userService);

// Create a sample user
userService.createUser({
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
});

// Login
authService.login('john@example.com', 'password123')
  .then(user => {
    if (user) {
      console.log('Login successful:', user.name);
    }
  });
