// La URL de donde quieres obtener el JSON
const url = 'https://edoinfo.et.bo/consultadeuda/';

fetch(url)
  .then(response => {
    // Verificamos si la respuesta es correcta (status 200-299)
    if (!response.ok) {
      throw new Error('Error en la petición');
    }
    return response.json(); // Aquí transformamos la respuesta a JSON
  })
  .then(data => {
    console.log(data); // ¡Listo! Aquí tienes tu JSON capturado en la variable 'data'
  })
  .catch(error => {
    console.error('Hubo un problema:', error);
  });