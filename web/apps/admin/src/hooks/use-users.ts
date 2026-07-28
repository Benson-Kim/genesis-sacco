import { useQuery } from '@tanstack/react-query';
import { access } from '@genesis/api-client';

export function useUsers() {
  return useQuery({
    queryKey: ['access', 'users'],
    queryFn: () => access.listUsers(),
  });
}
