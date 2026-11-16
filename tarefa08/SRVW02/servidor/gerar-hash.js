// Escreve o hash bcrypt (custo 10) da palavra-passe indicada na linha de comandos.
// Uso: node gerar-hash.js <palavra-passe>
import bcrypt from 'bcryptjs';

const CUSTO = 10;
const palavraPasse = process.argv[2];

if (palavraPasse === undefined || palavraPasse.length < 8) {
  console.error('Uso: node gerar-hash.js <palavra-passe>  (mínimo de 8 caracteres)');
  process.exit(1);
}

console.log(bcrypt.hashSync(palavraPasse, CUSTO));
