2.2 · Diagnóstico inicial
(a) O URL identifica o recurso (o quê) e o método diz o que fazer com ele. Por isso /avisos/42 serve para três operações: GET obtém, PUT substitui por inteiro, DELETE remove. O recurso é o mesmo; o que muda é a ação pedida.

(b) Um método é idempotente quando repeti-lo tem o mesmo efeito que executá-lo uma vez. Um PUT repetido grava outra vez o mesmo estado, por isso é inofensivo. Um POST repetido cria outro elemento (duplicados), por isso, se a rede falhar e um cliente ou proxy repetir o pedido, é perigoso.

(c) no-cache permite guardar a resposta, mas obriga a revalidar com o servidor antes de cada uso (com If-None-Match, e o servidor responde 304 se nada mudou). no-store proíbe guardar a resposta, seja onde for.

5. Como o id e o estado só são exigidos nas respostas
Sugestao junta, através de allOf, SugestaoNova (o que o cliente envia, sem id nem estado) com um objeto cujas propriedades novas estão marcadas readOnly: true e listadas em required; o pedido usa SugestaoNova, e readOnly + required só obriga a que apareçam nas respostas.

Pormenor: o estado e o estadoAnterior referem Estado com $ref, e tudo o que está ao lado de um $ref é ignorado. Por isso o readOnly está num objeto que envolve o $ref num allOf de um só elemento. Se o readOnly estivesse ao lado do $ref, perdia-se em silêncio.

10. · «Antes de avançar» (cache)
Porque é que max-age=3600 não contradiz «recalculadas de hora a hora»? Porque a cópia fica válida no máximo uma hora, que é exatamente o intervalo entre recálculos: o cliente nunca guarda por mais tempo do que o ritmo a que os dados mudam. O custo é um pequeno atraso (ver reflexão).
Que cabeçalho do pedido faz um 200 de obterSugestao passar a 304? If-None-Match, com o ETag que o cliente recebeu da última vez.

4.5 · Reflexão crítica
1. As regras de transição só estão em texto. Chega a quem escreve o cliente para saber as regras e desenhar a interface, mas uma ferramenta não consegue ler uma description: o cliente não pode gerar ou validar automaticamente quais as transições possíveis, e só descobre uma transição inválida ao receber o 409. A quem escreve o servidor chega ainda menos: o contrato não verifica a regra, e implementá-la fica por conta do programador, com risco de divergir da descrição.

2. numeroAluno na listagem. É um problema: expõe um dado pessoal de todos os alunos a quem listar. O contrato de base não consegue exprimir «visível só para o autor»: isso exigiria autenticação e autorização (securitySchemes/security), que a ficha exclui. A conclusão é que este problema fica sem resposta completa no contrato de base e para mais tarde.

3. max-age=3600. Ganham o servidor e a rede (menos pedidos, resposta imediata, bom para dados iguais para todos). Perde quem precisa do valor mais recente: a cópia pode ter até uma hora, e os dados já tinham até uma hora desde o último recálculo, ou seja, quase duas horas de atraso possível. Com no-cache o cliente revalidaria em cada uso: dados sempre atuais, mais pedidos ao servidor, mas se houver ETag a maioria seria um 304 sem corpo.

4. Versão v1 e propriedade obrigatória nova.

Nova obrigatória em SugestaoNova: os clientes existentes continuam a enviar o corpo antigo e passam a receber 400. Quebra a compatibilidade e obriga a v2.
Nova obrigatória apenas em Sugestao: os clientes existentes recebem um campo a mais e, em geral, ignoram-no. É compatível e não obriga a v2.
5. YAML a descrever, JSON a transportar. São camadas diferentes. O YAML é o formato do documento de especificação, lido por pessoas e ferramentas; o JSON é o formato dos corpos que a API troca na rede (application/json). O YAML descreve e o JSON transporta; por isso não há contradição.

6. Contrato antes ou depois. Escrito antes, o contrato faz com que cliente e servidor trabalhem sobre o mesmo documento e que se detetem cedo os desacordos: nomes de campos, tipos, null, URLs, códigos de erro (400 ou 404?), cache. Corrigir isso é editar texto. Descoberto na integração, cada desacordo já está escrito em código nos dois lados e cada um resolveu a ambiguidade à sua maneira.