// ─── Lesson Data ─────────────────────────────────────────────────────
// Structured curriculum for lessons 1-5 (Financial Management).
// Each lesson has a variable number of messages — the router and builder
// read messages.length dynamically; nothing assumes a fixed count.

export interface LessonMessage {
  order: number;
  type: 'escenario' | 'explicación' | 'ejemplo' | 'pregunta' | 'profundización';
  contentEs: string;
}

export interface LessonData {
  lessonNumber: number;
  titleEs: string;
  category: string;
  keyConcepts: string[];
  selfCheckQuestions: string[];
  exercise: string;
  commitment: string;
  messages: LessonMessage[];
}

const LESSONS: Record<number, LessonData> = {
  1: {
    lessonNumber: 1,
    titleEs: 'Registros Financieros',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Un registro financiero es una herramienta donde anotas todos los ingresos y gastos de tu negocio cada día.',
      'Ingreso: el dinero que entra por ventas o servicios.',
      'Gasto: el dinero que sale por compras, arriendo, transporte, deudas, etc.',
      'Resultado: lo que queda al restar los gastos de los ingresos. Puede ser ganancia o pérdida.',
      'Fórmula diaria: Ingresos - Gastos = Resultado del día.',
    ],
    selfCheckQuestions: [
      '¿Llevo un registro del dinero que entra y sale de mi negocio?',
      '¿Sé cuánto gané o perdí el mes pasado?',
      '¿Reviso mis notas para saber a dónde va el dinero del negocio?',
      '¿Mi negocio puede funcionar sin mí por un tiempo?',
    ],
    exercise: 'Anota todos los ingresos y gastos de tu negocio cada día durante una semana. Al final de cada día, resta los gastos de los ingresos para saber tu resultado diario. Al final de la semana, suma los resultados para ver cómo te fue.',
    commitment: 'Voy a anotar todos los ingresos y gastos de mi negocio por una semana, todos los días. Voy a revisar mis notas al final de cada día.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Imagina que al final del mes sientes que trabajaste mucho, pero no sabes si realmente ganaste plata o la perdiste. Eso pasa cuando no anotamos lo que entra y sale del negocio. Hoy vamos a aprender a llevar un registro financiero para que siempre sepas cómo va tu negocio.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Un registro financiero es simplemente anotar cada día cuánto dinero entra (por ventas o servicios) y cuánto sale (compras, arriendo, transporte, deudas). Al final del día restas: Ingresos - Gastos = Resultado. Si el número es positivo, ganaste. Si es negativo, perdiste. Así de simple.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Por ejemplo: hoy vendiste empanadas por $60.000 y gastaste $45.000 en ingredientes y gas. Tu resultado del día es $60.000 - $45.000 = $15.000 de ganancia. Mañana haces lo mismo. Al final de la semana, sumas todos los resultados y sabes exactamente cómo te fue.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Ahora te toca a ti: esta semana, anota cada día cuánto vendiste y cuánto gastaste en tu negocio. Puede ser en un cuaderno, en el celular, donde quieras. ¿En qué vas a anotar tus registros esta semana?',
      },
    ],
  },
  2: {
    lessonNumber: 2,
    titleEs: 'Entidades Separadas',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Tu negocio y tú son dos "personas" diferentes con plata diferente.',
      'Mezclar la plata personal con la del negocio hace imposible saber si el negocio realmente gana o pierde.',
      'Separar las finanzas significa tener registros, cuentas o lugares diferentes para el dinero personal y el del negocio.',
      'Ponerte un sueldo fijo del negocio te ayuda a controlar los gastos personales y saber cuánto realmente gana el negocio.',
    ],
    selfCheckQuestions: [
      '¿Separo el dinero del negocio del dinero personal?',
      '¿Separo los gastos del negocio de los gastos personales?',
      '¿Pago cuando uso inventario o servicios del negocio para uso personal?',
      '¿Me pongo un sueldo fijo del negocio?',
    ],
    exercise: 'Calcula cuánto necesitas al mes para tus gastos personales (comida, transporte, servicios, otros). Luego revisa si tu negocio puede cubrir ese sueldo sin perder. Define un sueldo inicial realista y anótalo como gasto fijo del negocio.',
    commitment: 'Voy a separar el dinero del negocio del dinero personal. Voy a ponerme un sueldo fijo y anotarlo como gasto del negocio.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Te ha pasado que vendes bien en la semana, pero al final del mes no sabes a dónde se fue la plata? Muchas veces pasa porque usamos la misma plata para el negocio y para la casa. Hoy vamos a aprender por qué es tan importante separar esas dos cosas.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Piensa en tu negocio como otra persona. Esa "persona" tiene sus propios gastos (ingredientes, arriendo, transporte) y sus propios ingresos (ventas). Cuando mezclas tu plata personal con la del negocio, no puedes saber si el negocio realmente está ganando. La solución: separa el dinero en dos lugares diferentes y ponte un sueldo fijo que el negocio te paga cada mes.',
      },
      {
        order: 3,
        type: 'pregunta',
        contentEs: 'Hagamos un ejercicio rápido: ¿cuánto necesitas al mes para tus gastos personales? Piensa en comida, transporte, servicios de la casa y otros gastos. Dime un número aproximado y vamos a ver si tu negocio puede darte ese sueldo.',
      },
    ],
  },
  3: {
    lessonNumber: 3,
    titleEs: 'Presupuesto del Negocio',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Un presupuesto es un plan escrito de cuánto esperas ganar y gastar en un mes.',
      'Incluye: ingresos esperados (ventas), gastos fijos (arriendo, servicios, transporte), gastos variables (materia prima, empaque), y saldo esperado.',
      'El saldo esperado = Ingresos - Gastos. Si es positivo, puedes ahorrar o invertir. Si es negativo, necesitas ajustar.',
      'El presupuesto no es fijo — se puede ajustar si cambian los ingresos o gastos.',
    ],
    selfCheckQuestions: [
      '¿Planifico cuánto voy a gastar cada mes en mi negocio?',
      '¿Sé cuánto necesito vender para cubrir mis gastos?',
      '¿Reviso mi presupuesto al final del mes?',
      '¿Separo el presupuesto del negocio del presupuesto de la casa?',
    ],
    exercise: 'Crea un presupuesto mensual para tu negocio: anota cuánto esperas vender, cuáles son tus gastos fijos, cuáles tus gastos variables, y calcula el saldo esperado. Al final del mes, compara lo que planeaste con lo que pasó de verdad.',
    commitment: 'Voy a anotar cuánto espero vender y gastar este mes. Voy a alinear mis gastos con mi presupuesto. Voy a revisarlo al final del mes.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Alguna vez has llegado a mitad de mes y te das cuenta que ya no te alcanza la plata? Sin un plan, es muy fácil gastar más de lo que uno gana. Hoy vamos a aprender a hacer un presupuesto — que es como un mapa que te dice a dónde va tu dinero.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Un presupuesto es simplemente escribir cuánto esperas vender y cuánto vas a gastar este mes. Tienes gastos fijos (arriendo, servicios, transporte — los pagas vendas o no) y gastos variables (materia prima, empaque — dependen de cuánto vendas). Al restar todos los gastos de tus ventas esperadas, sabes si te va a alcanzar o si necesitas ajustar algo.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Ejemplo: si esperas vender $2.350.000 este mes, y tus gastos fijos son $1.400.000 y tus gastos variables $500.000, tu saldo sería $450.000. Esa plata la puedes ahorrar o invertir en el negocio. Si el saldo fuera negativo, sabrías que necesitas vender más o gastar menos.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Ahora te toca: ¿cuánto crees que vas a vender este mes en tu negocio? Y ¿cuáles son tus gastos fijos principales? Dime los números que tengas y hacemos tu presupuesto juntos.',
      },
    ],
  },
  4: {
    lessonNumber: 4,
    titleEs: 'Ahorro',
    category: 'Gestión Financiera',
    keyConcepts: [
      'Ahorrar no es guardar lo que sobra — es apartar un porcentaje ANTES de gastar. La meta es mínimo el 10% de tus ingresos.',
      'Un fondo de emergencia es un ahorro especial para imprevistos (salud, reparaciones, accidentes). La meta es tener 3 meses de gastos guardados.',
      'Hay gastos esenciales (comida, vivienda, servicios), gastos del negocio (materiales, transporte), y gastos innecesarios (antojos, lujos). Identifica cuáles puedes reducir.',
      'El primer paso es anotar todos tus gastos de la semana y clasificarlos en esenciales y no esenciales.',
    ],
    selfCheckQuestions: [
      '¿Anoto lo que gasto y lo que gano cada semana?',
      '¿Guardo algo de dinero, por poco que sea?',
      '¿Tengo un fondo de emergencia?',
      '¿Planifico lo que voy a gastar antes de gastarlo?',
    ],
    exercise: 'Haz un presupuesto personal semanal: anota tus ingresos, luego separa gastos esenciales y no esenciales. Calcula cuánto puedes apartar para ahorro (mínimo 10%) y para tu fondo de emergencia.',
    commitment: 'Voy a crear un presupuesto mensual. Voy a apartar una parte de mis ingresos para ahorro. Voy a empezar un fondo de emergencia, aunque sea con poquito.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Qué harías si de repente necesitaras $100.000 para una emergencia? ¿Los tienes guardados? Muchos negocios y familias pasan dificultades porque no han planeado sus finanzas. Hoy vamos a hablar de cómo ahorrar de verdad — no con lo que sobra, sino con un plan.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'El secreto del ahorro es apartar el dinero ANTES de gastar, no después. La meta es guardar mínimo el 10% de lo que ganas. También necesitas un fondo de emergencia — un ahorro especial para imprevistos como problemas de salud o reparaciones. La meta es tener guardados 3 meses de gastos.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Para empezar, anota todos tus gastos de esta semana y clasifícalos: ¿cuáles son esenciales (comida, transporte, servicios) y cuáles no son tan necesarios (antojos, compras por impulso)? A veces descubrimos gastos pequeños que se acumulan sin darnos cuenta.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Hay algún gasto no esencial que podrías reducir esta semana? Piensa en algo pequeño que puedas recortar y usar esa plata para empezar tu ahorro. Cuéntame, ¿qué se te ocurre?',
      },
    ],
  },
  5: {
    lessonNumber: 5,
    titleEs: 'Punto de Equilibrio',
    category: 'Gestión Financiera',
    keyConcepts: [
      'El punto de equilibrio es la cantidad mínima de productos o servicios que necesitas vender para cubrir todos tus costos. Después de ese punto, empiezas a ganar.',
      'Gastos fijos (indirectos): los que pagas vendas o no — arriendo, servicios, transporte.',
      'Gastos variables (directos): los que cambian según cuánto produzcas — materiales, ingredientes, empaque.',
      'Margen = Precio de venta - Costo variable por unidad.',
      'Fórmula: Punto de equilibrio = Costos fijos / Margen por unidad.',
    ],
    selfCheckQuestions: [
      '¿Conozco los costos fijos de mi negocio?',
      '¿Sé cuánto me cuesta producir cada unidad de mi producto o servicio?',
      '¿Sé cuánto necesito vender para no perder dinero?',
      '¿Uso mi punto de equilibrio para fijar metas de ventas?',
    ],
    exercise: 'Calcula tu punto de equilibrio: 1) Anota tus costos fijos mensuales. 2) Calcula el costo variable por unidad. 3) Define tu precio de venta. 4) Aplica la fórmula: Costos fijos / (Precio - Costo variable) = unidades que necesitas vender.',
    commitment: 'Voy a calcular los costos fijos y variables de mi negocio. Voy a determinar mi punto de equilibrio. Voy a fijar una meta de ventas por encima de ese número.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: '¿Te has preguntado alguna vez si estás vendiendo lo suficiente? Puedes trabajar mucho y vender bastante, pero si no sabes cuánto necesitas vender para cubrir tus gastos, podrías estar perdiendo plata sin saberlo. Hoy vamos a aprender a calcular tu punto de equilibrio.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Tu negocio tiene dos tipos de gastos. Los fijos los pagas vendas o no: arriendo, servicios, transporte. Los variables cambian según cuánto vendas: ingredientes, materiales, empaque. El punto de equilibrio es la cantidad mínima que necesitas vender para cubrir TODOS esos gastos. La fórmula es: Costos fijos ÷ (Precio de venta - Costo variable por unidad).',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Ejemplo: Ana hace velas en su casa. Sus costos fijos son $300.000 al mes (arriendo, luz, gas). Cada vela le cuesta $3.000 en materiales y la vende a $8.000. Su margen es $5.000 por vela. Punto de equilibrio = $300.000 ÷ $5.000 = 60 velas. Ana necesita vender mínimo 60 velas al mes para no perder. Todo lo que venda después de 60 es ganancia.',
      },
      {
        order: 4,
        type: 'profundización',
        contentEs: 'La fórmula funciona igual para cualquier tipo de negocio. Si compras y revendes (como ropa o productos), el costo variable es lo que pagas por cada producto. Si ofreces servicios (como cortes de pelo o reparaciones), el costo variable son los materiales que usas en cada servicio. Lo importante es conocer tus dos tipos de costos.',
      },
      {
        order: 5,
        type: 'pregunta',
        contentEs: 'Hagamos tu cálculo: ¿cuánto pagas al mes en gastos fijos de tu negocio (arriendo, servicios, transporte)? Y ¿cuánto te cuesta producir o comprar una unidad de lo que vendes? Con esos números podemos calcular tu punto de equilibrio.',
      },
    ],
  },
  6: {
    lessonNumber: 6,
    titleEs: '¿A Quién Le Vendo? (Mercado)',
    category: 'Estrategia de Mercado',
    keyConcepts: [
      'No todo el mundo es tu cliente ideal; vender mejor empieza por enfocarte en un nicho.',
      'Conocer edad, hábitos, presupuesto y necesidad del cliente te ayuda a vender con más claridad.',
      'Escuchar al cliente evita invertir en productos que no se mueven.',
      'Cuando defines bien tu mercado, mejoras mensaje, producto y canal de venta.',
    ],
    selfCheckQuestions: [
      '¿Tengo claro quién me compra más seguido y por qué?',
      '¿Sé qué problema resuelvo para ese grupo de clientes?',
      '¿Estoy adaptando mi oferta según lo que mis clientes piden?',
    ],
    exercise: 'Habla esta semana con 3 clientes frecuentes y pregúntales qué valoran más, qué mejorarían y cuándo prefieren comprarte. Con eso, escribe una definición corta de tu cliente ideal.',
    commitment: 'Voy a enfocar mis ventas en el cliente que más necesita lo que ofrezco.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'A veces sentimos que vendemos "a todo el mundo", pero al final nadie queda realmente conectado con nuestro negocio. Eso hace que gastemos tiempo y plata en clientes que no vuelven. Hoy vamos a identificar a quién sí te conviene venderle.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Tu mercado es el grupo de personas que podría comprarte. Tu nicho es una parte más específica de ese mercado, con una necesidad clara. Mientras más claro tengas ese nicho, más fácil es vender sin rebajar tanto el precio.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Si vendes morrales en un barrio cerca de una universidad, puede que tu mejor cliente sea el estudiante que necesita espacio para portátil. Entonces ajustas tu mensaje, tus fotos y hasta tus promociones para ese perfil. Resultado: menos esfuerzo y mejores ventas.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Cuéntame: ¿quién es hoy tu cliente más frecuente (edad, tipo de trabajo, necesidad)? Con eso armamos una descripción simple de tu cliente ideal.',
      },
    ],
  },
  7: {
    lessonNumber: 7,
    titleEs: '¿Qué Vendo? (Producto)',
    category: 'Estrategia de Mercado',
    keyConcepts: [
      'Producto no es solo lo que vendes: también importa presentación, experiencia y confianza.',
      'Un buen producto resuelve una necesidad concreta del cliente.',
      'Diferenciarte puede ser empaque, calidad, rapidez, sabor o servicio adicional.',
      'Mejoras pequeñas basadas en feedback aumentan recompra.',
    ],
    selfCheckQuestions: [
      '¿Mi producto resuelve una necesidad clara?',
      '¿Qué me diferencia de otros negocios parecidos?',
      '¿Estoy recogiendo comentarios de clientes para mejorar?',
    ],
    exercise: 'Elige un producto principal y mejora una cosa esta semana: presentación, porción, combo, empaque o claridad del beneficio. Luego pide opinión a 3 clientes.',
    commitment: 'Voy a mejorar mi producto según lo que realmente valora mi cliente.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Muchos socios venden lo que saben hacer, pero no siempre lo que el cliente más necesita. Por eso a veces hay ventas sueltas, pero no crecimiento constante. Hoy vamos a afinar tu producto para que venda mejor.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'En marketing, producto incluye nombre, presentación, calidad, empaque y experiencia de compra. Si tu cliente entiende rápido qué le resuelves, confía más y compra más fácil. La idea es que tu producto sea claro, útil y recordable.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Una socia vendía empanadas sueltas. Empezó a ofrecer combo de 3 con ají casero y una bolsita bien presentada. No cambió todo el negocio, pero sí subió el ticket promedio porque el cliente sintió más valor.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué producto quieres mejorar primero y qué ajuste pequeño puedes probar esta semana para hacerlo más atractivo?',
      },
    ],
  },
  8: {
    lessonNumber: 8,
    titleEs: '¿A Cuánto Vendo? (Precio Justo)',
    category: 'Estrategia de Mercado',
    keyConcepts: [
      'Precio justo cubre costos y deja ganancia; no se define solo copiando al vecino.',
      'Debes considerar costos variables y costos fijos del negocio.',
      'Fórmula base: Precio = Costo total por unidad + ganancia esperada.',
      'Ajustar precio con criterio protege la sostenibilidad del negocio.',
    ],
    selfCheckQuestions: [
      '¿Conozco mi costo real por unidad?',
      '¿Mi precio actual incluye gastos como transporte, servicios o empaque?',
      '¿Estoy ganando lo suficiente por cada venta?',
    ],
    exercise: 'Calcula el costo real de un producto (materiales + parte proporcional de costos fijos), define la ganancia mínima por unidad y actualiza el precio sugerido.',
    commitment: 'Voy a poner precios con números claros, no por adivinanza.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Cuando ponemos precio "al ojo", a veces vendemos bastante pero igual no queda plata. Eso cansa y desmotiva porque trabajas duro sin ver resultado. Hoy vamos a sacar un precio justo para ti y para tu cliente.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'El precio debe cubrir: costo del producto, gastos del negocio y tu ganancia. Si te saltas alguna parte, el negocio se debilita. Precio justo no siempre es el más barato, es el que te permite sostener y mejorar tu negocio.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Si una arepa te cuesta $2.200 entre ingredientes y empaque, y además tienes costos fijos prorrateados por $500, tu costo real va en $2.700. Si quieres ganar $1.300 por unidad, el precio sugerido sería $4.000.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuál producto quieres recalcular hoy? Dame costo aproximado de materiales y precio actual, y te ayudo a estimar un precio más sano.',
      },
    ],
  },
  9: {
    lessonNumber: 9,
    titleEs: '¿Dónde y Cómo Vender Más?',
    category: 'Estrategia de Mercado',
    keyConcepts: [
      'Un buen punto de venta puede aumentar ventas sin cambiar el producto.',
      'Promoción constante ayuda a que te recuerden y te recompren.',
      'El embudo de ventas ordena el proceso: atraer, conversar, convertir y fidelizar.',
      'Probar canales nuevos en pequeño reduce riesgo.',
    ],
    selfCheckQuestions: [
      '¿Estoy vendiendo en el canal donde realmente está mi cliente?',
      '¿Estoy haciendo promoción con frecuencia?',
      '¿Sé qué parte de mi proceso de venta necesita mejora?',
    ],
    exercise: 'Prueba esta semana un canal nuevo (WhatsApp estados, punto móvil, aliado comercial o domicilio) y mide cuántos contactos nuevos y cuántas ventas te genera.',
    commitment: 'Voy a moverme al canal donde mi cliente compra con más facilidad.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Puedes tener un producto buenísimo, pero si nadie se entera o no te encuentra fácil, no vendes. A veces el problema no es el producto, sino el lugar y la forma de vender. Hoy vamos a revisar eso con lupa.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Punto de venta es donde el cliente te encuentra: físico o digital. Promoción es cómo llamas su atención: voz a voz, estados, afiches, combos, mensajes. Vender más es combinar bien ambos, según tu cliente ideal.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Piensa en embudo: primero te conocen, luego preguntan, después compran y por último regresan. Si te llegan muchos mensajes pero compran pocos, debes mejorar oferta o cierre. Si compran una vez y no vuelven, debes trabajar fidelización.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Dónde te está funcionando mejor hoy: local, domicilio, WhatsApp o recomendados? Escogemos uno para fortalecer esta semana y uno nuevo para probar.',
      },
    ],
  },
  10: {
    lessonNumber: 10,
    titleEs: 'Servicio al Cliente',
    category: 'Ventas y Atención al Cliente',
    keyConcepts: [
      'Un buen servicio convierte una venta en relación de largo plazo.',
      'Escuchar, responder rápido y cumplir lo prometido genera confianza.',
      'La experiencia del cliente importa tanto como el producto.',
      'Resolver quejas con respeto protege tu reputación.',
    ],
    selfCheckQuestions: [
      '¿Respondo con amabilidad incluso cuando estoy ocupado?',
      '¿Cumplo tiempos y condiciones que prometo al cliente?',
      '¿Aprendo de reclamos para mejorar el negocio?',
    ],
    exercise: 'Define 3 estándares simples de atención (saludo, tiempo de respuesta y cierre de compra) y aplícalos durante una semana.',
    commitment: 'Voy a tratar cada cliente como alguien que quiero que vuelva.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Dos negocios venden lo mismo, pero uno siempre está lleno. Muchas veces la diferencia no es precio: es trato. Hoy veremos cómo un servicio cálido y ordenado te puede subir ventas sin gastar más.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Servicio al cliente es cómo haces sentir a la persona antes, durante y después de comprar. Saludar bien, explicar claro, cumplir horarios y resolver dudas rápido construye confianza. Cuando hay confianza, hay recompra.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'En una peluquería de barrio empezaron a confirmar citas por WhatsApp y a avisar si iban retrasados. Ese detalle redujo cancelaciones y mejoró recomendaciones. El servicio se volvió parte del producto.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué punto de tu atención crees que hoy está más flojo: respuesta, cumplimiento, trato o seguimiento?',
      },
    ],
  },
  11: {
    lessonNumber: 11,
    titleEs: 'Técnicas de Venta',
    category: 'Ventas y Atención al Cliente',
    keyConcepts: [
      'Vender bien empieza por hacer preguntas y entender necesidad.',
      'Presentar beneficios concretos funciona mejor que solo listar características.',
      'Objeciones no son rechazo final; son oportunidad para aclarar.',
      'Cerrar venta requiere invitación clara a la acción.',
    ],
    selfCheckQuestions: [
      '¿Pregunto antes de ofrecer?',
      '¿Explico beneficios que conecten con el problema del cliente?',
      '¿Pido el cierre de manera clara?',
    ],
    exercise: 'Prepara un guion corto de venta: 2 preguntas de necesidad, 3 beneficios clave y 1 frase de cierre. Practícalo en 5 conversaciones reales.',
    commitment: 'Voy a vender escuchando primero y cerrando con claridad.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'A veces hablamos mucho del producto, pero el cliente igual no compra. No es porque sea malo: es porque no conectamos con su necesidad. Hoy vamos a usar técnicas simples para vender mejor.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Primero pregunta, luego propone. Si entiendes para qué lo quiere, puedes hablar del beneficio correcto. Después validas objeciones y cierras con una invitación concreta: "¿Te lo separo para hoy?"',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Si vendes ropa, en vez de decir "esta blusa es bonita", puedes decir "esta tela fresca te sirve para trabajar todo el día sin calor". Ahí conectas con la necesidad real. Eso aumenta probabilidad de cierre.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuál objeción te aparece más: "está caro", "lo pienso", o "después"? Te ayudo a preparar una respuesta práctica.',
      },
    ],
  },
  12: {
    lessonNumber: 12,
    titleEs: 'Ventas por WhatsApp',
    category: 'Ventas y Atención al Cliente',
    keyConcepts: [
      'WhatsApp es un canal de ventas cuando se usa con orden y seguimiento.',
      'Catálogo, mensajes claros y tiempos de respuesta rápidos mejoran conversión.',
      'Estados y listas de difusión ayudan a visibilidad constante.',
      'Confirmación de pago, entrega y postventa fortalecen confianza.',
    ],
    selfCheckQuestions: [
      '¿Tengo mensajes y fotos claras para vender por WhatsApp?',
      '¿Hago seguimiento a clientes que preguntan pero no compran?',
      '¿Uso estados o difusión de forma constante?',
    ],
    exercise: 'Arma esta semana un mini flujo de venta por WhatsApp: saludo, oferta breve, cierre, confirmación y seguimiento de recompra.',
    commitment: 'Voy a usar WhatsApp como canal de venta ordenado y constante.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Muchos socios reciben mensajes por WhatsApp pero pocos se convierten en venta real. No basta con responder "sí hay". Hoy vamos a organizar tu proceso para vender más por chat.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Tu WhatsApp debe tener: saludo claro, fotos útiles, precio visible, forma de pago y entrega definida. Luego haces seguimiento corto y amable al que preguntó. Ese orden te ahorra tiempo y sube cierres.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Usa estados para mostrar producto y prueba social: pedidos entregados, opiniones y promociones semanales. Si alguien no responde, retoma con respeto: "Te escribo por si aún te interesa". Seguimiento sin presión funciona muy bien.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué parte se te enreda más hoy en WhatsApp: atraer, responder, cerrar o hacer seguimiento?',
      },
    ],
  },
  13: {
    lessonNumber: 13,
    titleEs: 'Deudas Bajo Control',
    category: 'Manejo de Deudas',
    keyConcepts: [
      'La deuda se vuelve manejable cuando la organizas con datos claros.',
      'Debes registrar monto, cuota, tasa, fecha y prioridad de cada deuda.',
      'No todas las deudas pesan igual: algunas ahogan más por interés o atraso.',
      'Controlar deuda libera flujo para el negocio y reduce estrés.',
    ],
    selfCheckQuestions: [
      '¿Tengo lista completa de todas mis deudas?',
      '¿Sé cuáles me generan más interés o mora?',
      '¿Tengo una prioridad de pago definida?',
    ],
    exercise: 'Haz una tabla con todas tus deudas y ordénalas por urgencia (mora/tasa alta/impacto en operación). Selecciona las 2 más críticas para empezar plan.',
    commitment: 'Voy a enfrentar mis deudas con orden y sin esconder números.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Cuando hay varias deudas, es normal sentirse ahogado y no saber por dónde arrancar. Pero el problema grande se vuelve manejable cuando lo pones en papel. Hoy te ayudo a tomar control.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Primer paso: listar todas las deudas con monto, cuota, interés y vencimiento. Segundo paso: priorizar las más costosas o atrasadas. Tercer paso: definir cuánto sí puedes pagar sin parar tu operación.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Si tienes una deuda informal con interés alto semanal y otra cuota bancaria al día, suele convenir atacar primero la que más te está drenando. No es pagar al azar, es pagar estratégicamente.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuántas deudas tienes hoy y cuál te está quitando más aire cada mes?',
      },
    ],
  },
  14: {
    lessonNumber: 14,
    titleEs: 'Plan de Pago de Deudas',
    category: 'Manejo de Deudas',
    keyConcepts: [
      'Un plan de pago ordena montos, fechas y prioridades para salir de deuda.',
      'Métodos útiles: bola de nieve (deuda pequeña primero) o avalancha (interés alto primero).',
      'Negociar plazos puede mejorar flujo y evitar mora.',
      'Sin seguimiento mensual, el plan se cae.',
    ],
    selfCheckQuestions: [
      '¿Tengo cuotas y fechas de pago calendarizadas?',
      '¿Estoy usando una estrategia de priorización?',
      '¿Estoy revisando avances cada mes?',
    ],
    exercise: 'Elige método (bola de nieve o avalancha), arma calendario de pagos por 3 meses y define monto fijo semanal o mensual para deuda.',
    commitment: 'Voy a seguir un plan de pago realista hasta recuperar tranquilidad financiera.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Pagar deudas sin plan es como llenar un balde con huecos. Entras y sales del mismo problema cada mes. Hoy vamos a crear un plan claro para que cada pago te acerque de verdad a salir de deuda.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Con bola de nieve pagas primero la deuda más pequeña para ganar impulso. Con avalancha atacas la de mayor interés para ahorrar más plata. Las dos sirven, lo importante es escoger una y sostenerla.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'También puedes negociar: cambiar fecha de pago, pedir plazo o unificar cuotas si te mejora flujo. Negociar no es fracaso; es administrar mejor. Lo clave es no prometer cuotas que no puedes cumplir.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuál método te suena más viable para tu caso hoy: bola de nieve o avalancha?',
      },
    ],
  },
  15: {
    lessonNumber: 15,
    titleEs: '¿Cuándo Pedir un Préstamo?',
    category: 'Manejo de Deudas',
    keyConcepts: [
      'Un préstamo útil debe aumentar capacidad de ingreso, no tapar desorden mensual.',
      'Antes de pedir, evalúa pago mensual, tasa, plazo y retorno esperado.',
      'Crédito para capital de trabajo o inversión productiva suele ser más sano que para gasto corriente.',
      'Si el flujo no alcanza, endeudarte más puede agravar el problema.',
    ],
    selfCheckQuestions: [
      '¿Para qué necesito el préstamo exactamente?',
      '¿El negocio puede pagar la cuota sin ahogarse?',
      '¿El préstamo va a generar más ingresos o solo cubrir huecos?',
    ],
    exercise: 'Evalúa una solicitud real con tres columnas: para qué se usará, cuánto genera, cuánto cuesta. Si no mejora flujo neto, no lo tomes todavía.',
    commitment: 'Solo voy a pedir préstamo cuando tenga propósito productivo y capacidad real de pago.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Cuando aprieta la caja, pedir préstamo parece la salida más rápida. Pero si entra deuda sin plan, puedes quedar peor al mes siguiente. Hoy vamos a decidir con cabeza fría cuándo sí y cuándo no.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Un buen préstamo financia algo que te produce más ingresos: inventario que rota, equipo que acelera producción o canal que vende más. Si solo cubre gastos atrasados sin corregir raíz, es una curita temporal. Debes medir cuota versus flujo disponible.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Si una panadería pide crédito para un horno que sube producción y ventas, puede tener sentido. Pero si pide para cubrir gastos de varios meses sin mejora operativa, el riesgo aumenta. La pregunta clave es: ¿esto me deja mejor o más amarrado?',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Si hoy pidieras préstamo, ¿en qué lo invertirías y cuánto esperas que te retorne por mes?',
      },
    ],
  },
  16: {
    lessonNumber: 16,
    titleEs: 'Proyectando el Negocio',
    category: 'Planificación y Crecimiento',
    keyConcepts: [
      'Proyectar es estimar ventas, costos y metas futuras con base en datos reales.',
      'Te permite anticipar necesidades de caja, compras e inversión.',
      'Escenarios (conservador, base, optimista) reducen sorpresa.',
      'Plan sin seguimiento se vuelve deseo; hay que revisar mensualmente.',
    ],
    selfCheckQuestions: [
      '¿Tengo una meta de ventas para los próximos 3 meses?',
      '¿Estoy proyectando costos además de ingresos?',
      '¿Reviso y ajusto mi proyección con datos reales?',
    ],
    exercise: 'Haz una proyección de 3 meses con escenario base: ventas esperadas, costos esperados y resultado mensual. Incluye una acción concreta para mejorar cada mes.',
    commitment: 'Voy a tomar decisiones mirando hacia adelante, no solo apagando incendios.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Muchos negocios sobreviven semana a semana, pero no crecen porque no proyectan. Sin proyección, cualquier gasto sorpresa te descuadra. Hoy vamos a planear los próximos meses con números simples.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Proyectar no es adivinar; es usar tu historial para estimar lo que puede pasar. Si sabes cuánto vendes, cuánto gastas y cuándo cae la demanda, puedes prepararte. Eso te da control y mejores decisiones.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Arma tres escenarios: conservador, base y optimista. Así no te confías de más ni te paralizas por miedo. Cuando el mes avanza, comparas real vs proyectado y corriges rápido.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuál sería una meta realista de ventas para el próximo mes en tu negocio?',
      },
    ],
  },
  17: {
    lessonNumber: 17,
    titleEs: 'Inventario',
    category: 'Inventario',
    keyConcepts: [
      'Inventario es saber qué tienes, cuánto tienes y cuánto te cuesta.',
      'Falta de inventario te hace perder ventas; exceso te congela caja.',
      'Rotación y punto de reposición evitan quiebres.',
      'Conteo frecuente reduce pérdidas por vencimiento, daño o fuga.',
    ],
    selfCheckQuestions: [
      '¿Sé exactamente qué productos tengo en stock?',
      '¿Tengo productos quietos que no rotan?',
      '¿Sé cuándo debo reponer antes de quedarme sin producto?',
    ],
    exercise: 'Haz conteo físico de inventario, marca productos de alta y baja rotación, y define nivel mínimo para reponer a tiempo.',
    commitment: 'Voy a manejar inventario con control para vender sin quedarme corto ni sobrado.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Perder una venta por no tener producto duele. Pero comprar de más también duele porque la plata se queda quieta. Hoy vamos a organizar inventario para que trabaje a favor de tu caja.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Control de inventario es registrar entradas, salidas y saldo real. Debes identificar qué rota rápido, qué rota lento y qué se está dañando. Con eso compras mejor y evitas pérdidas silenciosas.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'En una tienda de barrio, el socio definió mínimo de gaseosas, arroz y huevos según rotación semanal. Cuando llega al mínimo, repone de una vez. Así casi no pierde ventas por quiebre.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué producto se te acaba más rápido y cuál se te queda quieto?',
      },
    ],
  },
  18: {
    lessonNumber: 18,
    titleEs: 'Metas Personales y Objetivos SMART',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Una meta útil debe ser SMART: específica, medible, alcanzable, relevante y con tiempo definido.',
      'Metas vagas generan poca acción; metas concretas guían decisiones.',
      'Separar meta personal y meta de negocio ayuda a priorizar.',
      'Revisión semanal mantiene enfoque.',
    ],
    selfCheckQuestions: [
      '¿Mi meta está escrita con número y fecha?',
      '¿Sé qué acción semanal me acerca a esa meta?',
      '¿Estoy midiendo avance de forma simple?',
    ],
    exercise: 'Escribe una meta SMART de negocio y una personal para los próximos 90 días, con indicador y fecha de revisión semanal.',
    commitment: 'Voy a convertir mis sueños en metas claras con seguimiento real.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Decir "quiero mejorar mi negocio" suena bonito, pero no dice qué hacer mañana. Las metas vagas cansan porque no se pueden medir. Hoy las vamos a volver claras y accionables.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'SMART significa: específica, medible, alcanzable, relevante y con tiempo. Por ejemplo, no es lo mismo "vender más" que "aumentar 15% las ventas en 8 semanas". Así tu cabeza y tu agenda se alinean.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Meta SMART: "En 2 meses voy a vender 20 combos semanales de empanadas por WhatsApp, publicando estados 5 días a la semana y haciendo seguimiento a 10 clientes cada viernes". Eso sí se puede ejecutar y medir.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué meta concreta quieres lograr en 90 días y cómo la mediríamos?',
      },
    ],
  },
  19: {
    lessonNumber: 19,
    titleEs: 'Ley de la Expectativa',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Lo que esperas condiciona tu actitud y tus decisiones.',
      'Expectativas positivas realistas aumentan persistencia.',
      'Pensamiento derrotista reduce acción incluso con oportunidades.',
      'La expectativa se fortalece con evidencia y hábitos.',
    ],
    selfCheckQuestions: [
      '¿Qué me digo cuando el negocio se pone difícil?',
      '¿Estoy enfocándome más en posibilidades o en bloqueos?',
      '¿Tengo acciones concretas que respalden mis expectativas?',
    ],
    exercise: 'Escribe 3 expectativas positivas realistas para tu negocio y conéctalas con una acción diaria para sostenerlas.',
    commitment: 'Voy a entrenar una expectativa de crecimiento basada en acción diaria.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Dos personas con el mismo negocio pueden tener resultados distintos por su expectativa. Una ve problema y se frena; la otra ve reto y actúa. Hoy trabajamos esa mentalidad práctica.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'La expectativa no es magia: es una dirección mental. Si esperas que nada funcione, actúas con miedo. Si esperas mejora con trabajo, tomas decisiones más valientes y constantes.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'No se trata de negar problemas. Se trata de decir: "sí está duro, pero hay una acción que puedo hacer hoy". Esa frase cambia tu energía y tu resultado con el tiempo.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué expectativa limitante quieres cambiar esta semana por una expectativa útil?',
      },
    ],
  },
  20: {
    lessonNumber: 20,
    titleEs: 'Ley del Orden',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'El orden reduce estrés y mejora productividad.',
      'Orden en agenda, inventario y finanzas mejora decisiones.',
      'Pequeños sistemas diarios evitan caos acumulado.',
      'Lo que se ordena se puede medir y mejorar.',
    ],
    selfCheckQuestions: [
      '¿Tengo rutina clara para abrir y cerrar el negocio?',
      '¿Mi información clave está organizada y accesible?',
      '¿El desorden me está costando tiempo o plata?',
    ],
    exercise: 'Implementa una rutina de orden de 15 minutos al cierre: caja, pendientes, inventario crítico y agenda de mañana.',
    commitment: 'Voy a usar el orden como herramienta para crecer con menos desgaste.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Cuando todo está enredado, sientes que trabajas mucho y avanzas poco. El desorden se come tu energía y te hace reaccionar a última hora. Hoy ponemos orden que sí te sirva, sin complicarte.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Orden no es perfección, es sistema. Si sabes dónde está cada dato, cada insumo y cada pendiente, decides más rápido y fallas menos. En negocio pequeño, eso vale oro.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Una socia empezó a cerrar cada día con checklist corta: ventas del día, productos por reponer y 3 tareas de mañana. En dos semanas redujo olvidos y mejoró cumplimiento con clientes.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué área está más desordenada hoy en tu negocio: caja, inventario, agenda o seguimiento de clientes?',
      },
    ],
  },
  21: {
    lessonNumber: 21,
    titleEs: 'Ley del Reloj y la Oportunidad',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'El tiempo bien usado multiplica resultados en negocio pequeño.',
      'Priorizar actividades de alto impacto evita ocupación sin avance.',
      'Las oportunidades tienen ventana; actuar tarde cuesta ventas.',
      'Plan semanal + revisión diaria mejora ejecución.',
    ],
    selfCheckQuestions: [
      '¿Estoy priorizando lo urgente o lo importante?',
      '¿Identifico rápido oportunidades de venta o mejora?',
      '¿Tengo bloques de tiempo para tareas clave?',
    ],
    exercise: 'Haz una agenda semanal con 3 prioridades de alto impacto y asigna horario fijo para ejecutarlas.',
    commitment: 'Voy a administrar mi tiempo como recurso clave del negocio.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'A veces uno termina el día agotado, pero lo importante quedó pendiente. Eso pasa cuando el reloj lo manejan los imprevistos. Hoy vamos a recuperar control del tiempo y aprovechar oportunidades.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'No todo lo urgente te hace crecer. Debes separar tareas que solo te ocupan de tareas que sí mueven ventas o eficiencia. El tiempo bien enfocado es ventaja competitiva.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Una oportunidad puede ser un cliente nuevo, un canal o una alianza. Si no tienes espacio en agenda, la dejas pasar. Por eso planear bloques te ayuda a responder rápido cuando aparece algo bueno.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuál actividad te da más resultado y no le estás dedicando suficiente tiempo?',
      },
    ],
  },
  22: {
    lessonNumber: 22,
    titleEs: 'Ley de la Cosecha',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Resultados sostenibles vienen de acciones consistentes, no de golpes de suerte.',
      'Primero se siembra (hábito), luego se cosecha (resultado).',
      'La disciplina diaria compensa recursos limitados.',
      'Medir avances permite ajustar a tiempo.',
    ],
    selfCheckQuestions: [
      '¿Qué hábito diario estoy sembrando en mi negocio?',
      '¿Estoy esperando resultados sin constancia?',
      '¿Tengo indicadores simples para ver progreso?',
    ],
    exercise: 'Define un hábito diario de 20 minutos que impacte ventas (seguimiento, contenido, mejora de oferta) y mantenlo por 21 días.',
    commitment: 'Voy a sembrar acciones pequeñas todos los días para cosechar resultados grandes.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Queremos resultados rápidos, pero el negocio responde a constancia. Si solo actuamos cuando hay ánimo, la cosecha sale irregular. Hoy vamos a fortalecer la siembra diaria.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'La ley de la cosecha dice: lo que repites, crece. Si repites orden, seguimiento y buena atención, crece la confianza del cliente. Si repites improvisación, crece el desgaste.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Una socia empezó a dedicar 20 minutos diarios a seguimiento por WhatsApp. Al principio parecía poco, pero en un mes aumentó recompra porque sus clientes se sintieron atendidos.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué hábito pequeño puedes sembrar desde mañana para mejorar tu negocio?',
      },
    ],
  },
  23: {
    lessonNumber: 23,
    titleEs: 'Ley del Balance',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Negocio sano requiere equilibrio entre trabajo, familia, salud y descanso.',
      'Sin balance, baja energía y calidad de decisiones.',
      'Poner límites de tiempo protege sostenibilidad personal y del negocio.',
      'Balance no es hacer todo perfecto; es priorizar sin abandonarte.',
    ],
    selfCheckQuestions: [
      '¿Estoy descuidando salud o familia por el negocio?',
      '¿Tengo momentos definidos de descanso?',
      '¿Estoy tomando decisiones cansado o saturado?',
    ],
    exercise: 'Define 2 límites concretos esta semana (horario de cierre y espacio personal/familiar) y cúmplelos 5 días.',
    commitment: 'Voy a crecer sin destruir mi bienestar personal y familiar.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Muchos emprendedores sienten que deben estar "prendidos" todo el día. Pero cuando no hay balance, llega el agotamiento y el negocio también se resiente. Hoy trabajamos equilibrio inteligente.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Balance significa distribuir energía donde importa: negocio, familia, salud y descanso. No es bajar compromiso; es sostenerlo en el tiempo. Un negocio que depende de una persona quemada se vuelve frágil.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Puedes empezar con límites simples: hora de cierre, día de revisión financiera y espacio fijo para tu familia. Esos límites mejoran claridad mental y te ayudan a decidir mejor.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué límite te hace más falta hoy para recuperar equilibrio?',
      },
    ],
  },
  24: {
    lessonNumber: 24,
    titleEs: 'Ley del 1%',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Mejorar 1% diario genera cambios grandes acumulados.',
      'Progreso pequeño y constante supera cambios extremos que no se sostienen.',
      'Cada mejora debe ser medible y repetible.',
      'La clave es continuidad, no perfección.',
    ],
    selfCheckQuestions: [
      '¿Qué mejora pequeña puedo implementar hoy?',
      '¿Estoy esperando cambios enormes para empezar?',
      '¿Estoy registrando pequeñas mejoras semanales?',
    ],
    exercise: 'Elige una mejora del 1% diaria en ventas u operación y regístrala por 30 días en una hoja simple.',
    commitment: 'Voy a crecer con mejoras pequeñas, constantes y medibles.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'A veces queremos cambiar todo de una y eso termina agotándonos. La ley del 1% propone algo más realista: mejorar un poquito cada día. Parece poco, pero acumulado transforma el negocio.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Un 1% puede ser: responder más rápido, mejorar una foto, ordenar un proceso o hacer un seguimiento adicional. Lo importante es que sea concreto y repetible. Constancia le gana a la intensidad de un solo día.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Un socio de comidas mejoró 1% diario su empaque, su mensaje y su tiempo de entrega. En pocas semanas empezó a recibir más referidos, no por una gran campaña, sino por mejoras acumuladas.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Cuál será tu mejora del 1% para mañana?',
      },
    ],
  },
  25: {
    lessonNumber: 25,
    titleEs: 'Valores Personales y del Negocio',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Valores son principios que guían decisiones cuando hay presión.',
      'Alinear valores personales y del negocio fortalece reputación.',
      'Clientes perciben coherencia entre lo que dices y lo que haces.',
      'Valores claros ayudan a elegir socios, precios y formas de atender.',
    ],
    selfCheckQuestions: [
      '¿Tengo claros mis valores como emprendedor?',
      '¿Mi forma de vender refleja esos valores?',
      '¿Estoy tomando decisiones por urgencia o por principios?',
    ],
    exercise: 'Define 3 valores del negocio y escribe una acción práctica para demostrar cada uno durante la semana.',
    commitment: 'Voy a tomar decisiones de negocio alineadas con mis valores.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Cuando hay presión por vender, a veces uno cede en cosas importantes. Ahí es donde los valores te sostienen y te cuidan de decisiones que luego pesan. Hoy vamos a aterrizarlos a tu negocio.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Valores como honestidad, cumplimiento, respeto o calidad no son frases bonitas. Son criterios para decidir cómo cobras, cómo respondes y cómo cumples. Eso construye confianza real con los clientes.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Si tu valor es cumplimiento, no prometes entrega imposible. Mejor dices tiempo real y lo cumples. Ese detalle hace que el cliente vuelva y te recomiende.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué tres valores quieres que tu negocio refleje desde hoy?',
      },
    ],
  },
  26: {
    lessonNumber: 26,
    titleEs: 'Ley del Crecimiento',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'Crecer exige aprender, desaprender y ajustar.',
      'La incomodidad es parte normal del crecimiento.',
      'Formación, práctica y retroalimentación aceleran progreso.',
      'El crecimiento sostenido es proceso, no evento.',
    ],
    selfCheckQuestions: [
      '¿Qué habilidad necesito desarrollar para crecer?',
      '¿Estoy evitando cambios por miedo o costumbre?',
      '¿Estoy buscando retroalimentación para mejorar?',
    ],
    exercise: 'Elige una habilidad clave (ventas, costos, inventario o digital) y practica 30 minutos, 3 veces por semana durante un mes.',
    commitment: 'Voy a crecer aprendiendo de forma intencional y constante.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Todo negocio que crece pasa por etapas incómodas: aprender algo nuevo, cambiar procesos y salir de la zona conocida. Eso no significa que vas mal; significa que estás evolucionando.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'La ley del crecimiento dice que para subir de nivel debes convertir aprendizaje en hábito. No basta con escuchar consejos; hay que probar, medir y ajustar. Ahí es donde aparece el cambio real.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Crecer también implica soltar prácticas que antes servían, pero hoy te frenan. Lo importante es revisar qué te acerca a tu meta y qué no. Sin juicio, pero con decisión.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué habilidad te daría un salto importante en los próximos 3 meses?',
      },
    ],
  },
  27: {
    lessonNumber: 27,
    titleEs: 'Ley de la Gratitud',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'La gratitud fortalece resiliencia y enfoque en medio de la presión.',
      'Reconocer avances mantiene motivación y constancia.',
      'Agradecer clientes y aliados mejora relaciones comerciales.',
      'Gratitud y ambición pueden convivir: agradeces hoy y construyes mañana.',
    ],
    selfCheckQuestions: [
      '¿Reconozco mis avances recientes, aunque sean pequeños?',
      '¿Agradezco activamente a clientes y personas que me apoyan?',
      '¿Estoy trabajando desde escasez o desde valor?',
    ],
    exercise: 'Durante 7 días, registra 3 cosas por agradecer del negocio y envía un mensaje de agradecimiento a 3 clientes fieles.',
    commitment: 'Voy a practicar gratitud diaria para sostener mi energía y mis relaciones.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Cuando todo se pone pesado, es fácil olvidar lo que sí ha avanzado. Eso baja ánimo y enfoque. Hoy vamos a usar la gratitud como herramienta práctica para recuperar fuerza.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Gratitud no es conformarse. Es reconocer lo que ya tienes para construir desde ahí, con cabeza más clara. Un emprendedor agradecido suele comunicar mejor y cuidar más sus relaciones.',
      },
      {
        order: 3,
        type: 'ejemplo',
        contentEs: 'Una socia empezó a cerrar semana agradeciendo a clientes frecuentes por WhatsApp. Esos mensajes simples fortalecieron vínculo y le aumentaron recompras. Gratitud también puede ser estrategia de fidelización.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: '¿Qué tres cosas de tu negocio puedes agradecer hoy, con nombre propio?',
      },
    ],
  },
  28: {
    lessonNumber: 28,
    titleEs: 'Mi Propósito',
    category: 'Mentalidad de Crecimiento',
    keyConcepts: [
      'El propósito conecta tu negocio con el impacto que quieres dejar.',
      'Tener propósito claro mejora enfoque, disciplina y decisiones.',
      'Propósito bien definido orienta metas de largo plazo.',
      'Cuando sabes tu para qué, sostienes mejor los momentos difíciles.',
    ],
    selfCheckQuestions: [
      '¿Tengo claro para qué hago este negocio?',
      '¿Mis metas actuales reflejan ese propósito?',
      '¿Mi forma de trabajar honra lo que considero importante?',
    ],
    exercise: 'Escribe un enunciado de propósito en primera persona (1–2 líneas), compártelo con alguien de confianza y define una acción semanal alineada con ese propósito.',
    commitment: 'Voy a dirigir mi negocio con propósito, no solo por urgencia del día a día.',
    messages: [
      {
        order: 1,
        type: 'escenario',
        contentEs: 'Hay días en que vender parece solo sobrevivir. En esos momentos, recordar tu propósito te devuelve dirección y sentido. Hoy cerramos el proceso conectando tu negocio con tu para qué.',
      },
      {
        order: 2,
        type: 'explicación',
        contentEs: 'Propósito es la razón profunda por la que haces lo que haces. Puede ser sostener a tu familia, generar empleo en tu barrio o construir independencia financiera. Ese para qué te ayuda a decidir mejor.',
      },
      {
        order: 3,
        type: 'profundización',
        contentEs: 'Cuando tu propósito está claro, filtras oportunidades: eliges las que te acercan y sueltas las que te distraen. No todo ingreso inmediato te conviene si te aleja de tu visión.',
      },
      {
        order: 4,
        type: 'pregunta',
        contentEs: 'Si resumieras en una frase tu propósito como emprendedor, ¿cómo sonaría?',
      },
    ],
  },
};

export function getLessonData(lessonNumber: number): LessonData {
  const lesson = LESSONS[lessonNumber];
  if (!lesson) {
    throw new Error(`Lesson ${lessonNumber} not found. Only lessons 1-${Object.keys(LESSONS).length} are available.`);
  }
  return lesson;
}

export function getLessonTitle(lessonNumber: number): string {
  const lesson = LESSONS[lessonNumber];
  if (!lesson) return `Lección ${lessonNumber}`;
  return lesson.titleEs;
}

export function hasLessonData(lessonNumber: number): boolean {
  return lessonNumber in LESSONS;
}
