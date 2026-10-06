## Ponto 14 · Reflexão crítica (esboço, a reescrever por palavras tuas)

- **Atributo vs. elemento.** Perde-se a marca de origem, mas não o dado. Importa a quem precisa de converter de volta para XML ou de preservar a semântica original; a quem só consome os valores, pouco ou nada.
- **Ordem.** Para o programa leitor é sobretudo uma vantagem: acede-se por nome, não por posição, e produtores diferentes podem escrever em ordens diferentes. A fraqueza é que, se a ordem tivesse significado, o schema não o protege.
- **Combinações absurdas aceites.** `totalAlunos` 16 com inscritos 12+8 = 20; inscritos TP1/TP2 sem relação com o total; `data` que não coincide com nenhum horário real; `cursos` repetidos. Impedir isto exige validação aritmética/relacional fora do schema de base (ou mecanismos fora do âmbito).
- **`required` novo.** Todos os documentos antigos passam a ser inválidos. Teria evitado o problema deixar a propriedade opcional (fora de `required`) ou versionar o schema.
- **Custo de validar vs. não validar.** Validar custa pouco e apanha cedo erros de tipo, falta de campos e valores fora do domínio, poupando ao programa leitor verificações defensivas espalhadas e falhas tardias, difíceis de diagnosticar.
