import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAyPYU3zQB_ptoxoHfjYBISJdAqLJuoSTc",
  authDomain: "paris-dakar-gerencial.firebaseapp.com",
  projectId: "paris-dakar-gerencial",
  storageBucket: "paris-dakar-gerencial.firebasestorage.app",
  messagingSenderId: "358605719811",
  appId: "1:358605719811:web:6e4d632d548fa84e644136",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ref = doc(db, "usuarios", "u-1");
const snap = await getDoc(ref);

if (!snap.exists()) {
  console.log("DOC_NOT_FOUND");
  process.exit(0);
}

console.log("DOC_DATA:", JSON.stringify(snap.data(), null, 2));
