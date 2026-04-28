import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export async function saveUser(user) {
  await setDoc(doc(db, 'users', user.id), {
    name: user.name,
    email: user.email,
    profilePic: user.picture,
  });
}