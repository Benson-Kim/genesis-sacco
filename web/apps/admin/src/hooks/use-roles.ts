import { useQuery } from '@tanstack/react-query';
import { access } from '@genesis/api-client';

export function useRoles() {
  return useQuery({
    queryKey: ['access', 'roles'],
    queryFn: () => access.listRoles(),
  });
}
