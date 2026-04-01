import { redirect } from 'next/navigation';

/** Production root URL always opens sign-in; logged-in users are bounced from /login. */
export default function Home() {
  redirect('/login');
}
